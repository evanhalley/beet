//! PR fetching + assembly. Port of `src/lib/github/prs.ts`.
//!
//! `fetch_review_requests` and `fetch_my_open_prs` search GitHub, then fan out
//! per-PR detail/comments/reviews calls. The JS version used an unbounded
//! `Promise.all`; here the fan-out is bounded with `buffer_unordered` so a
//! reviewer on 100 PRs cannot fire 300 concurrent requests (§7 / prs.ts TODO).

use crate::error::BeetResult;
use crate::github::client::{GithubClient, RateLimitInfo};
use crate::github::models::{CheckRunsResult, CommentRow, PullDetail, ReviewRow, SearchResult};
use crate::github::teams::resolve_team_members;
use crate::poller::types::{
    ActionableItem, ActionableItemMergeQueue, ActionableItemPr, ActionableKind, EjectedCheck,
    PrLifecycle,
};
use crate::scoring::score_pull_requests;
use crate::store::db::now_iso;
use crate::store::lifecycle::{
    detect_ejection, get_latest_ejection_event, get_latest_lifecycle_row, record_ejection_event,
    record_lifecycle,
};
use crate::store::Db;
use crate::tasks::{compile_task_regex, extract_task_urls};
use futures::stream::{self, StreamExt};
// Two different regex engines: `regex` for our own URL parsers (linear,
// fast), `fancy_regex` for the user-supplied taskRegex (supports JS-era
// patterns with lookaround / backreferences). Aliased here so the call
// sites read clearly.
use fancy_regex::Regex as TaskRegex;
use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

/// Upper bound on concurrent per-PR fan-out requests.
const MAX_PR_CONCURRENCY: usize = 8;

const EJECTION_CHECK_CONCLUSIONS: &[&str] =
    &["failure", "cancelled", "timed_out", "action_required"];

/// Items plus the freshest core-API rate-limit reading observed while building
/// them.
#[derive(Debug, Default)]
pub struct FetchOutcome {
    pub items: Vec<ActionableItem>,
    pub rate_limit: Option<RateLimitInfo>,
}

/// One entry from the per-PR `buffer_unordered` stream. The leading `usize`
/// is the PR's index in the original search response, used to restore search
/// order before the (stable) score / updated_at sort.
type AssembledItem = (
    usize,
    BeetResult<(Option<ActionableItem>, Option<RateLimitInfo>)>,
);

pub fn parse_repo_and_owner_from_url(url: &str) -> Option<(String, String)> {
    static GITHUB_RE: OnceLock<Regex> = OnceLock::new();
    static REPOS_RE: OnceLock<Regex> = OnceLock::new();
    let github_re =
        GITHUB_RE.get_or_init(|| Regex::new(r"github\.com/([^/]+)/([^/]+)").unwrap());
    let repos_re = REPOS_RE.get_or_init(|| Regex::new(r"repos/([^/]+)/([^/]+)").unwrap());
    let caps = github_re.captures(url).or_else(|| repos_re.captures(url))?;
    Some((caps[1].to_string(), caps[2].to_string()))
}

/// Count distinct reviewers whose latest non-pending review is APPROVED.
pub fn count_distinct_approvers(reviews: &[ReviewRow]) -> i64 {
    let mut latest: HashMap<String, String> = HashMap::new();
    for r in reviews {
        let Some(ref user) = r.user else { continue };
        if r.state == "PENDING" {
            continue;
        }
        latest.insert(user.login.clone(), r.state.clone());
    }
    latest.values().filter(|s| s.as_str() == "APPROVED").count() as i64
}

pub fn derive_lifecycle(pull: &PullDetail) -> PrLifecycle {
    if pull.state == "closed" {
        return if pull.merged {
            PrLifecycle::Merged
        } else {
            PrLifecycle::Closed
        };
    }
    if pull
        .auto_merge
        .as_ref()
        .is_some_and(|v| !v.is_null())
    {
        return PrLifecycle::MergeQueue;
    }
    if pull
        .requested_reviewers
        .as_ref()
        .map_or(0, |r| r.len())
        > 0
    {
        return PrLifecycle::InReview;
    }
    PrLifecycle::Open
}

pub async fn fetch_failing_checks(
    client: &GithubClient,
    db: &Db,
    owner: &str,
    repo: &str,
    head_sha: &str,
) -> BeetResult<Vec<EjectedCheck>> {
    let cache_key = format!("commit:{owner}/{repo}@{head_sha}:check-runs");
    let url = client.url(&format!(
        "/repos/{owner}/{repo}/commits/{head_sha}/check-runs"
    ));
    let res = client
        .beet_get::<CheckRunsResult>(db, &cache_key, &url)
        .await?;
    Ok(res
        .body
        .check_runs
        .into_iter()
        .filter(|r| {
            r.conclusion
                .as_deref()
                .is_some_and(|c| EJECTION_CHECK_CONCLUSIONS.contains(&c))
        })
        .map(|r| EjectedCheck {
            name: r.name,
            conclusion: r.conclusion.unwrap_or_default(),
            details_url: r.html_url,
        })
        .collect())
}

pub struct FetchReviewRequestsOptions {
    pub username: String,
    pub teams: Vec<String>,
    pub penalized_bots: Vec<String>,
    pub task_regex: String,
}

pub struct FetchMyOpenPrsOptions {
    pub username: String,
    pub task_regex: String,
}

/// Build the `/search/issues` URL for query string `q`.
fn search_url(client: &GithubClient, q: &str) -> BeetResult<String> {
    let url = reqwest::Url::parse_with_params(&client.url("/search/issues"), &[("q", q)])
        .map_err(|e| crate::error::BeetError::Other(format!("bad search url: {e}")))?;
    Ok(url.to_string())
}

pub async fn fetch_review_requests(
    client: &GithubClient,
    db: &Db,
    opts: &FetchReviewRequestsOptions,
) -> BeetResult<FetchOutcome> {
    let q = format!("is:pr is:open review-requested:{}", opts.username);
    let cache_key = format!("search:review-requested:{}", opts.username);
    let url = search_url(client, &q)?;

    let (search_res, team_members_res) = tokio::join!(
        client.beet_get::<SearchResult>(db, &cache_key, &url),
        resolve_team_members(client, db, &opts.teams),
    );
    let search = search_res?.body;
    let team_members = team_members_res?;
    if search.items.is_empty() {
        return Ok(FetchOutcome::default());
    }

    let compiled = compile_task_regex(Some(&opts.task_regex));
    let username = &opts.username;
    let team_members = &team_members;
    let compiled_ref = compiled.as_ref();

    // Carry the search-result index alongside each task so we can restore
    // GitHub's search order before scoring. score_pull_requests's stable sort
    // then preserves that order for equal-score items, eliminating the
    // completion-order shuffle that buffer_unordered would otherwise create.
    let assembled: Vec<AssembledItem> =
        stream::iter(search.items.into_iter().enumerate())
            .map(|(idx, hit)| async move {
                let res = assemble_review_item(
                    client,
                    db,
                    hit,
                    username,
                    team_members,
                    compiled_ref,
                )
                .await;
                (idx, res)
            })
            .buffer_unordered(MAX_PR_CONCURRENCY)
            .collect()
            .await;

    let (items, rate_limit) = collect_assembled(assembled)?;

    // Score every review-request item but never filter here: the frontend
    // decides visibility from the (session-overridable) "show all" toggle, so
    // the full scored list must cross the boundary.
    let items = score_pull_requests(items, true, &opts.penalized_bots);
    Ok(FetchOutcome { items, rate_limit })
}

pub async fn fetch_my_open_prs(
    client: &GithubClient,
    db: &Db,
    opts: &FetchMyOpenPrsOptions,
) -> BeetResult<FetchOutcome> {
    let q = format!("is:pr is:open author:{}", opts.username);
    let cache_key = format!("search:author:@me:{}", opts.username);
    let url = search_url(client, &q)?;

    let search = client
        .beet_get::<SearchResult>(db, &cache_key, &url)
        .await?
        .body;
    if search.items.is_empty() {
        return Ok(FetchOutcome::default());
    }

    let compiled = compile_task_regex(Some(&opts.task_regex));
    let username = &opts.username;
    let compiled_ref = compiled.as_ref();

    let assembled: Vec<AssembledItem> =
        stream::iter(search.items.into_iter().enumerate())
            .map(|(idx, hit)| async move {
                let res =
                    assemble_my_pr_item(client, db, hit, username, compiled_ref).await;
                (idx, res)
            })
            .buffer_unordered(MAX_PR_CONCURRENCY)
            .collect()
            .await;

    let (mut items, rate_limit) = collect_assembled(assembled)?;

    // Stable sort: equal updated_at keeps search order (set by collect_assembled).
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(FetchOutcome { items, rate_limit })
}

/// Drain the `buffer_unordered` output into items + the last seen rate limit.
///
/// Behavior:
/// - The **first critical** error (rate-limit, auth, transient, network)
///   short-circuits the whole cycle so adaptive backoff and the error UI
///   react. Non-critical per-item errors are silently dropped — one broken
///   PR shouldn't take the whole cycle down.
/// - Items are sorted by their original search index, so the downstream
///   stable sort (by score / by updated_at) preserves GitHub's search order
///   for ties.
fn collect_assembled(
    mut assembled: Vec<AssembledItem>,
) -> BeetResult<(Vec<ActionableItem>, Option<RateLimitInfo>)> {
    assembled.sort_by_key(|(idx, _)| *idx);

    let mut rate_limit = None;
    let mut items = Vec::new();
    for (_, result) in assembled {
        let (maybe_item, rl) = result?;
        if rl.is_some() {
            rate_limit = rl;
        }
        if let Some(item) = maybe_item {
            items.push(item);
        }
    }
    Ok((items, rate_limit))
}

/// Fetch detail/comments/reviews for one PR concurrently. Errors propagate;
/// the *caller* (an `assemble_*` function) decides whether to swallow them
/// (non-critical = drop this PR) or surface them (critical = abort the cycle).
async fn fetch_pr_triple(
    client: &GithubClient,
    db: &Db,
    owner: &str,
    repo: &str,
    num: i64,
) -> BeetResult<(PullDetail, Vec<CommentRow>, Vec<ReviewRow>, Option<RateLimitInfo>)> {
    let detail_url = client.url(&format!("/repos/{owner}/{repo}/pulls/{num}"));
    let comments_url = client.url(&format!("/repos/{owner}/{repo}/issues/{num}/comments"));
    let reviews_url = client.url(&format!("/repos/{owner}/{repo}/pulls/{num}/reviews"));
    let detail_key = format!("pr:{owner}/{repo}#{num}:detail");
    let comments_key = format!("pr:{owner}/{repo}#{num}:comments");
    let reviews_key = format!("pr:{owner}/{repo}#{num}:reviews");

    let (detail, comments, reviews) = tokio::join!(
        client.beet_get::<PullDetail>(db, &detail_key, &detail_url),
        client.beet_get::<Vec<CommentRow>>(db, &comments_key, &comments_url),
        client.beet_get::<Vec<ReviewRow>>(db, &reviews_key, &reviews_url),
    );
    let detail = detail?;
    let comments = comments?;
    let reviews = reviews?;
    let rate_limit = detail.rate_limit;
    Ok((detail.body, comments.body, reviews.body, rate_limit))
}

async fn assemble_review_item(
    client: &GithubClient,
    db: &Db,
    hit: crate::github::models::SearchItem,
    username: &str,
    team_members: &HashSet<String>,
    compiled_regex: Option<&TaskRegex>,
) -> BeetResult<(Option<ActionableItem>, Option<RateLimitInfo>)> {
    let url_for_parse = hit.html_url.as_deref().unwrap_or(&hit.url);
    let Some((owner, repo)) = parse_repo_and_owner_from_url(url_for_parse) else {
        return Ok((None, None));
    };
    let num = hit.number;

    let (pull, comments, reviews, rate_limit) =
        match fetch_pr_triple(client, db, &owner, &repo, num).await {
            Ok(t) => t,
            // Rate-limit, auth, transient: bubble up so the cycle reacts.
            Err(e) if e.is_critical() => return Err(e),
            // Per-PR failure (PR deleted, JSON skew, etc.): drop this item.
            Err(_) => return Ok((None, None)),
        };
    let Some(ref pull_user) = pull.user else {
        return Ok((None, rate_limit));
    };

    let author = pull_user.login.clone();
    let is_review_requested_from_me = pull
        .requested_reviewers
        .as_ref()
        .is_some_and(|rs| rs.iter().any(|r| r.login == username));
    let is_author_on_my_team = team_members.contains(&author);
    let ive_commented = comments
        .iter()
        .any(|c| c.user.as_ref().is_some_and(|u| u.login == username));
    let ive_reviewed = reviews
        .iter()
        .any(|r| r.user.as_ref().is_some_and(|u| u.login == username));
    let ive_approved = reviews.iter().any(|r| {
        r.user.as_ref().is_some_and(|u| u.login == username) && r.state == "APPROVED"
    });
    let approval_count = count_distinct_approvers(&reviews);
    let task_urls = extract_task_urls(pull.body.as_deref(), compiled_regex);
    let lifecycle = derive_lifecycle(&pull);

    let item = ActionableItem {
        id: format!("pr:{owner}/{repo}#{num}"),
        kind: ActionableKind::Pr,
        title: pull.title.clone(),
        url: pull.html_url.clone(),
        repo_full_name: format!("{owner}/{repo}"),
        updated_at: pull.updated_at.clone(),
        unread: true,
        dismissed_until_fingerprint: None,
        pr: Some(ActionableItemPr {
            number: num,
            author: author.clone(),
            body: pull.body.clone(),
            is_authored_by_me: author == username,
            is_review_requested_from_me,
            is_author_on_my_team,
            ive_commented,
            ive_reviewed,
            ive_approved,
            approval_count,
            is_draft: pull.draft,
            additions: pull.additions,
            deletions: pull.deletions,
            created_at: pull.created_at.clone(),
            lifecycle,
            merge_queue: None,
            task_urls,
            score: 0,
        }),
    };
    Ok((Some(item), rate_limit))
}

async fn assemble_my_pr_item(
    client: &GithubClient,
    db: &Db,
    hit: crate::github::models::SearchItem,
    username: &str,
    compiled_regex: Option<&TaskRegex>,
) -> BeetResult<(Option<ActionableItem>, Option<RateLimitInfo>)> {
    let url_for_parse = hit.html_url.as_deref().unwrap_or(&hit.url);
    let Some((owner, repo)) = parse_repo_and_owner_from_url(url_for_parse) else {
        return Ok((None, None));
    };
    let num = hit.number;
    let pr_id = format!("pr:{owner}/{repo}#{num}");

    let (pull, comments, reviews, rate_limit) =
        match fetch_pr_triple(client, db, &owner, &repo, num).await {
            Ok(t) => t,
            Err(e) if e.is_critical() => return Err(e),
            Err(_) => return Ok((None, None)),
        };
    let Some(ref pull_user) = pull.user else {
        return Ok((None, rate_limit));
    };

    let lifecycle = derive_lifecycle(&pull);

    // detect_ejection reads the *previous* recorded state; record_lifecycle then
    // writes the new one. Order matches prs.ts.
    let ejected = {
        let conn = match db.lock() {
            Ok(c) => c,
            Err(_) => return Ok((None, rate_limit)),
        };
        let ejected = detect_ejection(&conn, &pr_id, lifecycle).unwrap_or(false);
        let _ = record_lifecycle(&conn, &pr_id, lifecycle);
        ejected
    };

    let merge_queue = build_merge_queue(
        client, db, &owner, &repo, &pr_id, &pull, lifecycle, ejected,
    )
    .await;

    let author = pull_user.login.clone();
    let is_review_requested_from_me = pull
        .requested_reviewers
        .as_ref()
        .is_some_and(|rs| rs.iter().any(|r| r.login == username));
    let ive_commented = comments
        .iter()
        .any(|c| c.user.as_ref().is_some_and(|u| u.login == username));
    let ive_reviewed = reviews
        .iter()
        .any(|r| r.user.as_ref().is_some_and(|u| u.login == username));
    let ive_approved = reviews.iter().any(|r| {
        r.user.as_ref().is_some_and(|u| u.login == username) && r.state == "APPROVED"
    });
    let approval_count = count_distinct_approvers(&reviews);
    let task_urls = extract_task_urls(pull.body.as_deref(), compiled_regex);

    let item = ActionableItem {
        id: pr_id,
        kind: ActionableKind::Pr,
        title: pull.title.clone(),
        url: pull.html_url.clone(),
        repo_full_name: format!("{owner}/{repo}"),
        updated_at: pull.updated_at.clone(),
        unread: true,
        dismissed_until_fingerprint: None,
        pr: Some(ActionableItemPr {
            number: num,
            author,
            body: pull.body.clone(),
            is_authored_by_me: true,
            is_review_requested_from_me,
            is_author_on_my_team: false,
            ive_commented,
            ive_reviewed,
            ive_approved,
            approval_count,
            is_draft: pull.draft,
            additions: pull.additions,
            deletions: pull.deletions,
            created_at: pull.created_at.clone(),
            lifecycle,
            merge_queue,
            task_urls,
            score: 0,
        }),
    };
    Ok((Some(item), rate_limit))
}

/// Replicates the merge-queue / ejection hydration block of `fetchMyOpenPrs`
/// (prs.ts:304-359).
#[allow(clippy::too_many_arguments)]
async fn build_merge_queue(
    client: &GithubClient,
    db: &Db,
    owner: &str,
    repo: &str,
    pr_id: &str,
    pull: &PullDetail,
    lifecycle: PrLifecycle,
    ejected: bool,
) -> Option<ActionableItemMergeQueue> {
    if ejected {
        let now = now_iso();
        // The check-runs fetch is auxiliary: if it fails the PR must still
        // surface, just without populated ejectedChecks. Next poll retries.
        let mut ejected_checks: Vec<EjectedCheck> = Vec::new();
        if let Ok(checks) =
            fetch_failing_checks(client, db, owner, repo, &pull.head.sha).await
        {
            if let Ok(conn) = db.lock() {
                let _ = record_ejection_event(&conn, pr_id, &pull.head.sha, &checks);
            }
            ejected_checks = checks;
        }
        return Some(ActionableItemMergeQueue {
            position: None,
            entered_at: now.clone(),
            last_ejection_at: Some(now),
            ejected_checks: Some(ejected_checks),
        });
    }

    if lifecycle != PrLifecycle::MergeQueue {
        // Sticky "Kicked from queue" badge: hydrate from the last ejection event
        // while the head SHA still matches.
        let prior = db
            .lock()
            .ok()
            .and_then(|conn| get_latest_ejection_event(&conn, pr_id).ok().flatten());
        if let Some(prior) = prior {
            if prior.head_sha == pull.head.sha {
                return Some(ActionableItemMergeQueue {
                    position: None,
                    entered_at: prior.observed_at.clone(),
                    last_ejection_at: Some(prior.observed_at),
                    ejected_checks: Some(prior.failing_checks),
                });
            }
        }
        return None;
    }

    // Currently in the merge queue. record_lifecycle only inserts on a
    // transition, so the latest row's observed_at is when the PR entered.
    let entered_at = db
        .lock()
        .ok()
        .and_then(|conn| get_latest_lifecycle_row(&conn, pr_id).ok().flatten())
        .map(|row| row.observed_at)
        .unwrap_or_else(now_iso);
    Some(ActionableItemMergeQueue {
        position: None,
        entered_at,
        last_ejection_at: None,
        ejected_checks: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::models::{GitRef, UserRef};
    use crate::store::db::open_in_memory;
    use std::sync::Mutex;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn fetch_review_requests_assembles_and_scores_end_to_end() {
        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/search/issues"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "items": [{
                    "number": 1,
                    "html_url": "https://github.com/foo/bar/pull/1",
                    "url": "https://api.github.com/repos/foo/bar/issues/1",
                }]
            })))
            .mount(&server)
            .await;

        // Recent timestamps — an old PR would trip the stale-score rule.
        let now = chrono::Utc::now().to_rfc3339();
        Mock::given(method("GET"))
            .and(path("/repos/foo/bar/pulls/1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "title": "Add widget",
                "body": null,
                "html_url": "https://github.com/foo/bar/pull/1",
                "state": "open",
                "user": { "login": "octocat" },
                "requested_reviewers": [{ "login": "me" }],
                "head": { "sha": "deadbeef" },
                "additions": 10,
                "deletions": 5,
                "created_at": now,
                "updated_at": now,
            })))
            .mount(&server)
            .await;

        Mock::given(method("GET"))
            .and(path("/repos/foo/bar/issues/1/comments"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .mount(&server)
            .await;

        Mock::given(method("GET"))
            .and(path("/repos/foo/bar/pulls/1/reviews"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .mount(&server)
            .await;

        let db: Db = Mutex::new(open_in_memory().unwrap());
        let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
        let opts = FetchReviewRequestsOptions {
            username: "me".to_string(),
            teams: vec![],
            penalized_bots: vec![],
            task_regex: String::new(),
        };

        let outcome = fetch_review_requests(&client, &db, &opts).await.unwrap();
        assert_eq!(outcome.items.len(), 1);
        let item = &outcome.items[0];
        assert_eq!(item.id, "pr:foo/bar#1");
        let pr = item.pr.as_ref().unwrap();
        // is_review_requested_from_me => +3, nothing else => survives filter.
        assert!(pr.is_review_requested_from_me);
        assert_eq!(pr.score, 3);
        assert_eq!(pr.lifecycle, PrLifecycle::InReview);
    }

    #[tokio::test]
    async fn fetch_my_open_prs_detects_merge_queue_ejection() {
        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/search/issues"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "items": [{
                    "number": 2,
                    "html_url": "https://github.com/foo/bar/pull/2",
                    "url": "https://api.github.com/repos/foo/bar/issues/2",
                }]
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/repos/foo/bar/pulls/2"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "title": "My PR",
                "body": null,
                "html_url": "https://github.com/foo/bar/pull/2",
                "state": "open",
                "user": { "login": "me" },
                "head": { "sha": "sha-2" },
                "additions": 1,
                "deletions": 1,
                "created_at": "2026-01-01T00:00:00.000Z",
                "updated_at": "2026-01-02T00:00:00.000Z",
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/repos/foo/bar/issues/2/comments"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/repos/foo/bar/pulls/2/reviews"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/repos/foo/bar/commits/sha-2/check-runs"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "check_runs": [
                    { "name": "ci/build", "conclusion": "failure", "html_url": "https://x" },
                    { "name": "ci/lint", "conclusion": "success" },
                ]
            })))
            .mount(&server)
            .await;

        let db: Db = Mutex::new(open_in_memory().unwrap());
        // Seed: the PR was previously in the merge queue.
        {
            let conn = db.lock().unwrap();
            record_lifecycle(&conn, "pr:foo/bar#2", PrLifecycle::MergeQueue).unwrap();
        }

        let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
        let opts = FetchMyOpenPrsOptions {
            username: "me".to_string(),
            task_regex: String::new(),
        };
        let outcome = fetch_my_open_prs(&client, &db, &opts).await.unwrap();
        assert_eq!(outcome.items.len(), 1);
        let mq = outcome.items[0]
            .pr
            .as_ref()
            .unwrap()
            .merge_queue
            .as_ref()
            .expect("ejection should produce a mergeQueue with lastEjectionAt");
        assert!(mq.last_ejection_at.is_some());
        let checks = mq.ejected_checks.as_ref().unwrap();
        // Only the failing check is kept.
        assert_eq!(checks.len(), 1);
        assert_eq!(checks[0].name, "ci/build");
    }

    #[tokio::test]
    async fn per_pr_rate_limit_propagates_instead_of_silently_dropping() {
        // Regression: when a per-PR detail call hits 429, the old code
        // returned Ok with the PR missing and no rate_limit set. Now the
        // cycle aborts so adaptive backoff + the error UI react.
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/search/issues"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "items": [{
                    "number": 9,
                    "html_url": "https://github.com/foo/bar/pull/9",
                    "url": "https://api.github.com/repos/foo/bar/issues/9",
                }]
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/repos/foo/bar/pulls/9"))
            .respond_with(ResponseTemplate::new(429).insert_header("retry-after", "45"))
            .mount(&server)
            .await;
        // Comments + reviews respond 200 — only the detail call rate-limits.
        Mock::given(method("GET"))
            .and(path("/repos/foo/bar/issues/9/comments"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/repos/foo/bar/pulls/9/reviews"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .mount(&server)
            .await;

        let db: Db = Mutex::new(open_in_memory().unwrap());
        let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
        let opts = FetchReviewRequestsOptions {
            username: "me".to_string(),
            teams: vec![],
            penalized_bots: vec![],
            task_regex: String::new(),
        };
        let res = fetch_review_requests(&client, &db, &opts).await;
        assert!(matches!(
            res,
            Err(crate::error::BeetError::RateLimited { retry_after_secs: Some(45) })
        ));
    }

    fn pull(state: &str, merged: bool) -> PullDetail {
        PullDetail {
            title: "t".into(),
            body: None,
            html_url: "u".into(),
            state: state.into(),
            merged,
            auto_merge: None,
            user: Some(UserRef { login: "a".into() }),
            requested_reviewers: None,
            head: GitRef { sha: "sha".into() },
            draft: false,
            additions: 0,
            deletions: 0,
            created_at: "c".into(),
            updated_at: "u".into(),
        }
    }

    #[test]
    fn parses_repo_and_owner_from_html_and_api_urls() {
        // Primary path: GitHub search hits expose `html_url` first.
        assert_eq!(
            parse_repo_and_owner_from_url("https://github.com/foo/bar/pull/1"),
            Some(("foo".into(), "bar".into()))
        );
        // Fallback `repos/...` regex (used when only the API `url` is present
        // and it does not contain `github.com/`).
        assert_eq!(
            parse_repo_and_owner_from_url("repos/foo/bar/pulls/1"),
            Some(("foo".into(), "bar".into()))
        );
        assert_eq!(parse_repo_and_owner_from_url("not a url"), None);
    }

    #[test]
    fn derive_lifecycle_covers_all_states() {
        assert_eq!(derive_lifecycle(&pull("closed", true)), PrLifecycle::Merged);
        assert_eq!(derive_lifecycle(&pull("closed", false)), PrLifecycle::Closed);

        let mut p = pull("open", false);
        p.auto_merge = Some(serde_json::json!({ "enabled_by": {} }));
        assert_eq!(derive_lifecycle(&p), PrLifecycle::MergeQueue);

        let mut p = pull("open", false);
        p.auto_merge = Some(serde_json::Value::Null);
        p.requested_reviewers = Some(vec![UserRef { login: "r".into() }]);
        assert_eq!(derive_lifecycle(&p), PrLifecycle::InReview);

        assert_eq!(derive_lifecycle(&pull("open", false)), PrLifecycle::Open);
    }

    #[test]
    fn count_distinct_approvers_uses_latest_state_per_user() {
        let rows = |pairs: &[(&str, &str)]| {
            pairs
                .iter()
                .map(|(login, state)| ReviewRow {
                    user: Some(UserRef {
                        login: login.to_string(),
                    }),
                    state: state.to_string(),
                })
                .collect::<Vec<_>>()
        };
        // alice: APPROVED -> CHANGES_REQUESTED -> APPROVED (counts)
        // bob: APPROVED then PENDING (PENDING ignored, still counts)
        // carol: COMMENTED (does not count)
        let reviews = rows(&[
            ("alice", "APPROVED"),
            ("alice", "CHANGES_REQUESTED"),
            ("alice", "APPROVED"),
            ("bob", "APPROVED"),
            ("bob", "PENDING"),
            ("carol", "COMMENTED"),
        ]);
        assert_eq!(count_distinct_approvers(&reviews), 2);
    }
}
