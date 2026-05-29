//! PR fetching + assembly. Port of `src/lib/github/prs.ts`.
//!
//! `fetch_review_requests` and `fetch_my_open_prs` search GitHub, then fan out
//! per-PR detail/comments/reviews calls. The JS version used an unbounded
//! `Promise.all`; here the fan-out is bounded with `buffer_unordered` so a
//! reviewer on 100 PRs cannot fire 300 concurrent requests (§7 / prs.ts TODO).

use crate::error::BeetResult;
use crate::github::client::{GithubClient, RateLimitInfo};
use crate::github::merge_queue::enqueue_pr;
use crate::github::models::{
    CheckRunsResult, CommentRow, PullDetail, ReviewRow, SearchResult, UserRef,
};
use crate::github::teams::resolve_team_members;
use crate::poller::types::{
    ActionableItem, ActionableItemMergeQueue, ActionableItemPr, ActionableKind, CheckRunSummary,
    EjectedCheck, PrLifecycle, ReviewerEntry,
};
use crate::scoring::score_pull_requests;
use crate::store::db::now_iso;
use crate::store::lifecycle::{
    detect_ejection, get_latest_ejection_event, get_latest_lifecycle_row, record_ejection_event,
    record_lifecycle, PrSnapshot,
};
use crate::store::requeue::{count_attempts, is_opted_out, record_attempt};
use crate::store::Db;
use crate::tasks::{compile_task_regex, extract_task_urls};
use futures::stream::{self, StreamExt};
use serde::Serialize;
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
/// them. The auto-requeue worker (#13) also stashes any per-item mutation
/// errors here so the poll loop can attach them to the next `PollResultPayload`
/// (the `auto_requeue_errors` field) — the UI surfaces those as toast banners.
#[derive(Debug, Default)]
pub struct FetchOutcome {
    pub items: Vec<ActionableItem>,
    pub rate_limit: Option<RateLimitInfo>,
    pub auto_requeue_errors: Vec<AutoRequeueError>,
}

/// One auto-requeue mutation failure. Emitted to the frontend once per
/// `(pr_id, head_sha)` so the user sees a single banner per failure, not one
/// per poll cycle.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoRequeueError {
    pub pr_id: String,
    pub head_sha: String,
    pub message: String,
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
    let github_re = GITHUB_RE.get_or_init(|| Regex::new(r"github\.com/([^/]+)/([^/]+)").unwrap());
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

/// Reviewer roll-up that powers the DetailPane's Reviewers block. For each
/// reviewer who has submitted a review we keep their *latest* non-`PENDING`
/// state; reviewers who were requested but have not yet submitted appear with
/// `state = "requested"` so the block doesn't lose them.
pub fn build_reviewers(reviews: &[ReviewRow], requested: Option<&[UserRef]>) -> Vec<ReviewerEntry> {
    use std::collections::BTreeMap;

    // BTreeMap so the output is deterministic (alphabetical by login); the
    // design doesn't sort, but a stable order makes tests + snapshots sane.
    let mut latest: BTreeMap<String, String> = BTreeMap::new();
    for r in reviews {
        let Some(ref user) = r.user else { continue };
        if r.state == "PENDING" {
            continue;
        }
        // Insert overwrites — `reviews[]` is returned in submission order, so
        // the last write wins, which is the most recent review.
        latest.insert(user.login.clone(), r.state.clone());
    }

    let mut out: Vec<ReviewerEntry> = latest
        .into_iter()
        .map(|(login, gh_state)| ReviewerEntry {
            login,
            state: map_review_state(&gh_state),
        })
        .collect();

    if let Some(requested) = requested {
        let submitted: std::collections::HashSet<String> =
            out.iter().map(|r| r.login.clone()).collect();
        for r in requested {
            if !submitted.contains(&r.login) {
                out.push(ReviewerEntry {
                    login: r.login.clone(),
                    state: "requested".to_string(),
                });
            }
        }
    }
    out.sort_by(|a, b| a.login.cmp(&b.login));
    out
}

/// Map GitHub's REST review state enum to the contract strings the
/// DetailPane Pill mapping expects.
fn map_review_state(gh: &str) -> String {
    match gh {
        "APPROVED" => "approved",
        "CHANGES_REQUESTED" => "changes_requested",
        "COMMENTED" => "commented",
        "DISMISSED" => "dismissed",
        // Unknown future states fall through verbatim (lowercased) — the
        // frontend will render them as a neutral pill.
        _ => return gh.to_ascii_lowercase(),
    }
    .to_string()
}

pub fn derive_lifecycle(pull: &PullDetail) -> PrLifecycle {
    if pull.state == "closed" {
        return if pull.merged {
            PrLifecycle::Merged
        } else {
            PrLifecycle::Closed
        };
    }
    if pull.auto_merge.as_ref().is_some_and(|v| !v.is_null()) {
        return PrLifecycle::MergeQueue;
    }
    if pull.requested_reviewers.as_ref().map_or(0, |r| r.len()) > 0 {
        return PrLifecycle::InReview;
    }
    PrLifecycle::Open
}

/// Fetch every check-run for a head SHA, mapped to the contract shape the
/// frontend renders in the DetailPane's Checks block.
pub async fn fetch_check_runs(
    client: &GithubClient,
    db: &Db,
    owner: &str,
    repo: &str,
    head_sha: &str,
) -> BeetResult<Vec<CheckRunSummary>> {
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
        .map(|r| CheckRunSummary {
            name: r.name,
            status: r.status,
            conclusion: r.conclusion,
            details_url: r.html_url,
        })
        .collect())
}

/// Filter `fetch_check_runs` output down to the checks that knocked a PR out
/// of the merge queue. Used by `build_merge_queue`.
pub fn ejected_checks(runs: &[CheckRunSummary]) -> Vec<EjectedCheck> {
    runs.iter()
        .filter(|r| {
            r.conclusion
                .as_deref()
                .is_some_and(|c| EJECTION_CHECK_CONCLUSIONS.contains(&c))
        })
        .map(|r| EjectedCheck {
            name: r.name.clone(),
            conclusion: r.conclusion.clone().unwrap_or_default(),
            details_url: r.details_url.clone(),
        })
        .collect()
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
    /// Auto-requeue worker config (#13). Read from PollConfig at the top of
    /// each poll cycle.
    pub auto_requeue_enabled: bool,
    pub auto_requeue_max_attempts: u32,
    /// Empty = all repos eligible; non-empty = only these `owner/repo` repos.
    pub auto_requeue_repos: Vec<String>,
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
    let assembled: Vec<AssembledItem> = stream::iter(search.items.into_iter().enumerate())
        .map(|(idx, hit)| async move {
            let res =
                assemble_review_item(client, db, hit, username, team_members, compiled_ref).await;
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
    Ok(FetchOutcome {
        items,
        rate_limit,
        auto_requeue_errors: Vec::new(),
    })
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

    let assembled: Vec<AssembledItem> = stream::iter(search.items.into_iter().enumerate())
        .map(|(idx, hit)| async move {
            let res = assemble_my_pr_item(client, db, hit, username, compiled_ref).await;
            (idx, res)
        })
        .buffer_unordered(MAX_PR_CONCURRENCY)
        .collect()
        .await;

    let (mut items, rate_limit) = collect_assembled(assembled)?;

    // Stable sort: equal updated_at keeps search order (set by collect_assembled).
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    // Auto-requeue worker (#13). Runs after item assembly so it sees the same
    // `(pr_id, head_sha, pr_node_id, lifecycle, ejected_checks)` the row will
    // show — no extra GitHub roundtrip beyond the enqueue mutation itself.
    let auto_requeue_errors = maybe_auto_requeue(client, db, opts, &items).await?;

    Ok(FetchOutcome {
        items,
        rate_limit,
        auto_requeue_errors,
    })
}

/// Inspect each item for "currently ejected from the merge queue" state and
/// fire the `enqueuePullRequest` mutation when the worker is enabled, the cap
/// hasn't been hit, and the PR isn't opted out. Critical errors (rate-limit,
/// auth) abort the cycle; per-PR mutation failures are recorded against the
/// cap and returned to the caller for one-shot UI display.
async fn maybe_auto_requeue(
    client: &GithubClient,
    db: &Db,
    opts: &FetchMyOpenPrsOptions,
    items: &[ActionableItem],
) -> BeetResult<Vec<AutoRequeueError>> {
    if !opts.auto_requeue_enabled {
        return Ok(Vec::new());
    }

    let allowlist_active = !opts.auto_requeue_repos.is_empty();
    let mut errors = Vec::new();

    for item in items {
        let Some(pr) = item.pr.as_ref() else {
            continue;
        };
        // Only PRs that are *currently ejected*: an ejection event exists at
        // the current head SHA, but the PR has dropped back out of the queue.
        // `build_merge_queue` only attaches `ejected_checks` in that case.
        let Some(mq) = pr.merge_queue.as_ref() else {
            continue;
        };
        let Some(checks) = mq.ejected_checks.as_ref() else {
            continue;
        };
        if checks.is_empty() || pr.lifecycle == PrLifecycle::MergeQueue {
            continue;
        }
        if allowlist_active && !opts.auto_requeue_repos.contains(&item.repo_full_name) {
            continue;
        }
        let Some(head_sha) = mq.head_sha.as_deref() else {
            continue;
        };
        let Some(node_id) = mq.pr_node_id.as_deref() else {
            continue;
        };

        // Cap + opt-out checks are cheap DB reads — do them before the network
        // call so an over-cap PR doesn't burn a GitHub request.
        let (count, opted_out) = {
            let Ok(conn) = db.lock() else { continue };
            let count = count_attempts(&conn, &item.id, head_sha).unwrap_or(0);
            let opted_out = is_opted_out(&conn, &item.id, head_sha).unwrap_or(false);
            (count, opted_out)
        };
        if opted_out || count >= opts.auto_requeue_max_attempts as i64 {
            continue;
        }

        match enqueue_pr(client, node_id).await {
            Ok(()) => {
                if let Ok(conn) = db.lock() {
                    let _ = record_attempt(&conn, &item.id, head_sha, true);
                }
            }
            Err(e) if e.is_critical() => return Err(e),
            Err(e) => {
                let message = e.to_string();
                if let Ok(conn) = db.lock() {
                    let _ = record_attempt(&conn, &item.id, head_sha, false);
                }
                errors.push(AutoRequeueError {
                    pr_id: item.id.clone(),
                    head_sha: head_sha.to_string(),
                    message,
                });
            }
        }
    }

    Ok(errors)
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
) -> BeetResult<(
    PullDetail,
    Vec<CommentRow>,
    Vec<ReviewRow>,
    Option<RateLimitInfo>,
)> {
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
    let ive_approved = reviews
        .iter()
        .any(|r| r.user.as_ref().is_some_and(|u| u.login == username) && r.state == "APPROVED");
    let approval_count = count_distinct_approvers(&reviews);
    let task_urls = extract_task_urls(pull.body.as_deref(), compiled_regex);
    let lifecycle = derive_lifecycle(&pull);
    let reviewers = build_reviewers(&reviews, pull.requested_reviewers.as_deref());
    let check_runs = match fetch_check_runs(client, db, &owner, &repo, &pull.head.sha).await {
        Ok(runs) => Some(runs),
        Err(e) if e.is_critical() => return Err(e),
        Err(_) => None,
    };

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
            reviewers: Some(reviewers),
            check_runs,
            associated_runs: None,
        }),
        run: None,
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

    // Snapshot enough to render the PR's Recently Resolved row long after the
    // PR has rotated out of the live poll set (#6 follow-up). Author is
    // optional because some bot PRs omit `pull.user`; the renderer falls back.
    let snapshot = PrSnapshot {
        title: Some(pull.title.clone()),
        author: pull.user.as_ref().map(|u| u.login.clone()),
        url: Some(pull.html_url.clone()),
    };

    // detect_ejection reads the *previous* recorded state; record_lifecycle then
    // writes the new one. Order matches prs.ts.
    let ejected = {
        let conn = match db.lock() {
            Ok(c) => c,
            Err(_) => return Ok((None, rate_limit)),
        };
        let ejected = detect_ejection(&conn, &pr_id, lifecycle).unwrap_or(false);
        let _ = record_lifecycle(&conn, &pr_id, lifecycle, &snapshot);
        ejected
    };

    // Fetch check-runs once for this PR; the merge_queue builder reuses the
    // list to derive ejected_checks, so an ejected PR doesn't double-hit the
    // /check-runs endpoint.
    let check_runs = match fetch_check_runs(client, db, &owner, &repo, &pull.head.sha).await {
        Ok(runs) => Some(runs),
        Err(e) if e.is_critical() => return Err(e),
        Err(_) => None,
    };

    let merge_queue =
        build_merge_queue(db, &pr_id, &pull, lifecycle, ejected, check_runs.as_deref())?;

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
    let ive_approved = reviews
        .iter()
        .any(|r| r.user.as_ref().is_some_and(|u| u.login == username) && r.state == "APPROVED");
    let approval_count = count_distinct_approvers(&reviews);
    let task_urls = extract_task_urls(pull.body.as_deref(), compiled_regex);
    let reviewers = build_reviewers(&reviews, pull.requested_reviewers.as_deref());

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
            reviewers: Some(reviewers),
            check_runs,
            associated_runs: None,
        }),
        run: None,
    };
    Ok((Some(item), rate_limit))
}

/// Replicates the merge-queue / ejection hydration block of `fetchMyOpenPrs`
/// (prs.ts:304-359). `check_runs` is supplied by the caller — the assembler
/// already fetched it for the DetailPane's Checks block, so this function
/// derives the ejected subset from that list instead of re-hitting GitHub.
fn build_merge_queue(
    db: &Db,
    pr_id: &str,
    pull: &PullDetail,
    lifecycle: PrLifecycle,
    ejected: bool,
    check_runs: Option<&[CheckRunSummary]>,
) -> BeetResult<Option<ActionableItemMergeQueue>> {
    if ejected {
        let now = now_iso();
        // When the prior check-runs fetch failed (non-critical), record an
        // empty failing-checks list rather than crashing — matches the
        // pre-refactor behavior where a check-runs failure left the badge
        // populated but the checks empty.
        let failing_checks = check_runs.map(ejected_checks).unwrap_or_default();
        if let Ok(conn) = db.lock() {
            let _ = record_ejection_event(&conn, pr_id, &pull.head.sha, &failing_checks);
        }
        return Ok(Some(ActionableItemMergeQueue {
            position: None,
            entered_at: now.clone(),
            last_ejection_at: Some(now),
            ejected_checks: Some(failing_checks),
            head_sha: Some(pull.head.sha.clone()),
            pr_node_id: pull.node_id.clone(),
        }));
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
                return Ok(Some(ActionableItemMergeQueue {
                    position: None,
                    entered_at: prior.observed_at.clone(),
                    last_ejection_at: Some(prior.observed_at),
                    ejected_checks: Some(prior.failing_checks),
                    head_sha: Some(pull.head.sha.clone()),
                    pr_node_id: pull.node_id.clone(),
                }));
            }
        }
        return Ok(None);
    }

    // Currently in the merge queue. record_lifecycle only inserts on a
    // transition, so the latest row's observed_at is when the PR entered.
    let entered_at = db
        .lock()
        .ok()
        .and_then(|conn| get_latest_lifecycle_row(&conn, pr_id).ok().flatten())
        .map(|row| row.observed_at)
        .unwrap_or_else(now_iso);
    Ok(Some(ActionableItemMergeQueue {
        position: None,
        entered_at,
        last_ejection_at: None,
        ejected_checks: None,
        head_sha: Some(pull.head.sha.clone()),
        pr_node_id: pull.node_id.clone(),
    }))
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
            record_lifecycle(
                &conn,
                "pr:foo/bar#2",
                PrLifecycle::MergeQueue,
                &PrSnapshot::default(),
            )
            .unwrap();
        }

        let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
        let opts = FetchMyOpenPrsOptions {
            username: "me".to_string(),
            task_regex: String::new(),
            auto_requeue_enabled: false,
            auto_requeue_max_attempts: 2,
            auto_requeue_repos: vec![],
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

    /// Helper for the auto-requeue worker tests. Seeds the same mocks the
    /// detect-ejection test uses, plus a `pulls.get` body that includes
    /// `node_id` (needed for the GraphQL mutation) and a `head_sha` of the
    /// caller's choice.
    async fn seed_my_open_prs_with_ejection(server: &MockServer, head_sha: &str, node_id: &str) {
        Mock::given(method("GET"))
            .and(path("/search/issues"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "items": [{
                    "number": 7,
                    "html_url": "https://github.com/foo/bar/pull/7",
                    "url": "https://api.github.com/repos/foo/bar/issues/7",
                }]
            })))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path("/repos/foo/bar/pulls/7"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "title": "My PR",
                "body": null,
                "html_url": "https://github.com/foo/bar/pull/7",
                "node_id": node_id,
                "state": "open",
                "user": { "login": "me" },
                "head": { "sha": head_sha },
                "additions": 1,
                "deletions": 1,
                "created_at": "2026-01-01T00:00:00.000Z",
                "updated_at": "2026-01-02T00:00:00.000Z",
            })))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path("/repos/foo/bar/issues/7/comments"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path("/repos/foo/bar/pulls/7/reviews"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path(format!(
                "/repos/foo/bar/commits/{head_sha}/check-runs"
            )))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "check_runs": [
                    { "name": "ci/build", "conclusion": "failure" },
                ]
            })))
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn auto_requeue_fires_when_enabled_and_within_cap() {
        let server = MockServer::start().await;
        seed_my_open_prs_with_ejection(&server, "sha-r1", "PR_kwDOA").await;
        // Worker should POST one GraphQL mutation with the node_id.
        Mock::given(method("POST"))
            .and(path("/graphql"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": { "enqueuePullRequest": { "mergeQueueEntry": { "position": 4 } } }
            })))
            .expect(1)
            .mount(&server)
            .await;

        let db: Db = Mutex::new(open_in_memory().unwrap());
        {
            let conn = db.lock().unwrap();
            record_lifecycle(
                &conn,
                "pr:foo/bar#7",
                PrLifecycle::MergeQueue,
                &PrSnapshot::default(),
            )
            .unwrap();
        }
        let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
        let opts = FetchMyOpenPrsOptions {
            username: "me".to_string(),
            task_regex: String::new(),
            auto_requeue_enabled: true,
            auto_requeue_max_attempts: 2,
            auto_requeue_repos: vec![],
        };
        let outcome = fetch_my_open_prs(&client, &db, &opts).await.unwrap();
        assert!(outcome.auto_requeue_errors.is_empty());
        let conn = db.lock().unwrap();
        assert_eq!(count_attempts(&conn, "pr:foo/bar#7", "sha-r1").unwrap(), 1);
    }

    #[tokio::test]
    async fn auto_requeue_skips_when_disabled() {
        let server = MockServer::start().await;
        seed_my_open_prs_with_ejection(&server, "sha-r2", "PR_kwDOB").await;
        // No /graphql mock — if the worker fires, the call would 404 and the
        // worker would push an entry to auto_requeue_errors.

        let db: Db = Mutex::new(open_in_memory().unwrap());
        {
            let conn = db.lock().unwrap();
            record_lifecycle(
                &conn,
                "pr:foo/bar#7",
                PrLifecycle::MergeQueue,
                &PrSnapshot::default(),
            )
            .unwrap();
        }
        let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
        let opts = FetchMyOpenPrsOptions {
            username: "me".to_string(),
            task_regex: String::new(),
            auto_requeue_enabled: false,
            auto_requeue_max_attempts: 2,
            auto_requeue_repos: vec![],
        };
        let outcome = fetch_my_open_prs(&client, &db, &opts).await.unwrap();
        assert!(outcome.auto_requeue_errors.is_empty());
        let conn = db.lock().unwrap();
        assert_eq!(count_attempts(&conn, "pr:foo/bar#7", "sha-r2").unwrap(), 0);
    }

    #[tokio::test]
    async fn auto_requeue_respects_cap_across_cycles() {
        let server = MockServer::start().await;
        seed_my_open_prs_with_ejection(&server, "sha-r3", "PR_kwDOC").await;
        // Worker should only call once even though we run the cycle twice —
        // the second cycle hits the cap (max_attempts = 1).
        Mock::given(method("POST"))
            .and(path("/graphql"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": { "enqueuePullRequest": { "mergeQueueEntry": { "position": 1 } } }
            })))
            .expect(1)
            .mount(&server)
            .await;

        let db: Db = Mutex::new(open_in_memory().unwrap());
        {
            let conn = db.lock().unwrap();
            record_lifecycle(
                &conn,
                "pr:foo/bar#7",
                PrLifecycle::MergeQueue,
                &PrSnapshot::default(),
            )
            .unwrap();
        }
        let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
        let opts = FetchMyOpenPrsOptions {
            username: "me".to_string(),
            task_regex: String::new(),
            auto_requeue_enabled: true,
            auto_requeue_max_attempts: 1,
            auto_requeue_repos: vec![],
        };
        // Cycle 1 — fires the mutation.
        fetch_my_open_prs(&client, &db, &opts).await.unwrap();
        // Cycle 2 — already at the cap.
        fetch_my_open_prs(&client, &db, &opts).await.unwrap();
        let conn = db.lock().unwrap();
        assert_eq!(count_attempts(&conn, "pr:foo/bar#7", "sha-r3").unwrap(), 1);
    }

    #[tokio::test]
    async fn auto_requeue_respects_opt_out() {
        use crate::store::requeue::set_opt_out;
        let server = MockServer::start().await;
        seed_my_open_prs_with_ejection(&server, "sha-r4", "PR_kwDOD").await;

        let db: Db = Mutex::new(open_in_memory().unwrap());
        {
            let conn = db.lock().unwrap();
            record_lifecycle(
                &conn,
                "pr:foo/bar#7",
                PrLifecycle::MergeQueue,
                &PrSnapshot::default(),
            )
            .unwrap();
            set_opt_out(&conn, "pr:foo/bar#7", "sha-r4", true).unwrap();
        }
        let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
        let opts = FetchMyOpenPrsOptions {
            username: "me".to_string(),
            task_regex: String::new(),
            auto_requeue_enabled: true,
            auto_requeue_max_attempts: 2,
            auto_requeue_repos: vec![],
        };
        fetch_my_open_prs(&client, &db, &opts).await.unwrap();
        let conn = db.lock().unwrap();
        assert_eq!(count_attempts(&conn, "pr:foo/bar#7", "sha-r4").unwrap(), 0);
    }

    #[tokio::test]
    async fn auto_requeue_respects_repo_allowlist() {
        let server = MockServer::start().await;
        seed_my_open_prs_with_ejection(&server, "sha-r5", "PR_kwDOE").await;

        let db: Db = Mutex::new(open_in_memory().unwrap());
        {
            let conn = db.lock().unwrap();
            record_lifecycle(
                &conn,
                "pr:foo/bar#7",
                PrLifecycle::MergeQueue,
                &PrSnapshot::default(),
            )
            .unwrap();
        }
        let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
        let opts = FetchMyOpenPrsOptions {
            username: "me".to_string(),
            task_regex: String::new(),
            auto_requeue_enabled: true,
            auto_requeue_max_attempts: 2,
            // Allowlist active but doesn't include foo/bar → skip.
            auto_requeue_repos: vec!["other/repo".to_string()],
        };
        fetch_my_open_prs(&client, &db, &opts).await.unwrap();
        let conn = db.lock().unwrap();
        assert_eq!(count_attempts(&conn, "pr:foo/bar#7", "sha-r5").unwrap(), 0);
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
            Err(crate::error::BeetError::RateLimited {
                retry_after_secs: Some(45)
            })
        ));
    }

    fn pull(state: &str, merged: bool) -> PullDetail {
        PullDetail {
            title: "t".into(),
            body: None,
            html_url: "u".into(),
            node_id: None,
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
        assert_eq!(
            derive_lifecycle(&pull("closed", false)),
            PrLifecycle::Closed
        );

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
    fn build_reviewers_collapses_to_latest_per_login() {
        // alice: approved -> changes_requested -> approved (final approved).
        // bob: approved then PENDING (PENDING is ignored, bob stays approved).
        // carol: commented only.
        let reviews = vec![
            ReviewRow {
                user: Some(UserRef {
                    login: "alice".into(),
                }),
                state: "APPROVED".into(),
            },
            ReviewRow {
                user: Some(UserRef {
                    login: "alice".into(),
                }),
                state: "CHANGES_REQUESTED".into(),
            },
            ReviewRow {
                user: Some(UserRef {
                    login: "alice".into(),
                }),
                state: "APPROVED".into(),
            },
            ReviewRow {
                user: Some(UserRef {
                    login: "bob".into(),
                }),
                state: "APPROVED".into(),
            },
            ReviewRow {
                user: Some(UserRef {
                    login: "bob".into(),
                }),
                state: "PENDING".into(),
            },
            ReviewRow {
                user: Some(UserRef {
                    login: "carol".into(),
                }),
                state: "COMMENTED".into(),
            },
        ];
        let out = build_reviewers(&reviews, None);
        assert_eq!(out.len(), 3);
        // Output is alphabetical by login.
        assert_eq!(out[0].login, "alice");
        assert_eq!(out[0].state, "approved");
        assert_eq!(out[1].login, "bob");
        assert_eq!(out[1].state, "approved");
        assert_eq!(out[2].login, "carol");
        assert_eq!(out[2].state, "commented");
    }

    #[test]
    fn build_reviewers_includes_requested_with_no_submitted_review() {
        let reviews = vec![ReviewRow {
            user: Some(UserRef {
                login: "alice".into(),
            }),
            state: "APPROVED".into(),
        }];
        // bob was requested but hasn't reviewed yet → appears with state
        // "requested". alice already submitted → no duplicate row for her.
        let requested = vec![
            UserRef {
                login: "alice".into(),
            },
            UserRef {
                login: "bob".into(),
            },
        ];
        let out = build_reviewers(&reviews, Some(&requested));
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].login, "alice");
        assert_eq!(out[0].state, "approved");
        assert_eq!(out[1].login, "bob");
        assert_eq!(out[1].state, "requested");
    }

    #[tokio::test]
    async fn assemble_my_pr_item_attaches_full_check_runs() {
        // Same fixture shape as `fetch_my_open_prs_detects_merge_queue_ejection`
        // but checks span success + failure + in_progress to assert the full
        // list (not just failing) reaches the row.
        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/search/issues"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "items": [{
                    "number": 11,
                    "html_url": "https://github.com/foo/bar/pull/11",
                    "url": "https://api.github.com/repos/foo/bar/issues/11",
                }]
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/repos/foo/bar/pulls/11"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "title": "My PR",
                "body": null,
                "html_url": "https://github.com/foo/bar/pull/11",
                "state": "open",
                "user": { "login": "me" },
                "head": { "sha": "sha-c" },
                "additions": 1,
                "deletions": 1,
                "created_at": "2026-01-01T00:00:00.000Z",
                "updated_at": "2026-01-02T00:00:00.000Z",
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/repos/foo/bar/issues/11/comments"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/repos/foo/bar/pulls/11/reviews"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/repos/foo/bar/commits/sha-c/check-runs"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "check_runs": [
                    { "name": "build", "status": "completed", "conclusion": "success" },
                    { "name": "integration", "status": "completed", "conclusion": "failure" },
                    { "name": "deploy", "status": "in_progress", "conclusion": null },
                ]
            })))
            .mount(&server)
            .await;

        let db: Db = Mutex::new(open_in_memory().unwrap());
        let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
        let opts = FetchMyOpenPrsOptions {
            username: "me".to_string(),
            task_regex: String::new(),
            auto_requeue_enabled: false,
            auto_requeue_max_attempts: 2,
            auto_requeue_repos: vec![],
        };
        let outcome = fetch_my_open_prs(&client, &db, &opts).await.unwrap();
        let pr = outcome.items[0].pr.as_ref().unwrap();
        let runs = pr
            .check_runs
            .as_ref()
            .expect("check_runs should be populated");
        assert_eq!(runs.len(), 3);
        assert_eq!(runs[0].name, "build");
        assert_eq!(runs[0].conclusion.as_deref(), Some("success"));
        assert_eq!(runs[2].status.as_deref(), Some("in_progress"));
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
