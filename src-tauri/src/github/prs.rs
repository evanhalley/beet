//! PR fetching + assembly. Port of `src/lib/github/prs.ts`.
//!
//! `fetch_review_requests` and `fetch_my_open_prs` search GitHub, then fan out
//! per-PR detail/comments/reviews calls. The JS version used an unbounded
//! `Promise.all`; here the fan-out is bounded with `buffer_unordered` so a
//! reviewer on 100 PRs cannot fire 300 concurrent requests (§7 / prs.ts TODO).

use crate::error::BeetResult;
use crate::github::client::{GithubClient, RateLimitInfo};
use crate::github::models::{
    CheckRunsResult, CommentRow, GitRef, PullDetail, ReviewRow, SearchResult, UserRef,
};
use crate::github::pr_files::{fetch_pr_files, PrRef};
use crate::github::session_cache::SessionCache;
use crate::github::teams::resolve_team_members;
use crate::poller::types::{
    ActionableItem, ActionableItemMergeQueue, ActionableItemPr, ActionableKind, CheckRunSummary,
    CodeOwnership, EjectedCheck, PrLifecycle, ReviewerEntry,
};
use crate::scoring::score_pull_requests;
use crate::store::db::now_iso;
use crate::store::lifecycle::{
    detect_ejection, get_latest_ejection_event, get_latest_lifecycle_row, record_ejection_event,
    record_lifecycle, PrSnapshot,
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
    cache: &SessionCache,
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
                assemble_review_item(client, db, cache, hit, username, team_members, compiled_ref)
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

/// Owner of the fork a PR's head branch lives in, or `None` when the branch is
/// in the base repo `{owner}/{repo}`. Prefers `head.repo.full_name`; falls back
/// to the `owner:branch` label when the fork was deleted (`repo` is null).
pub(crate) fn head_fork_owner(head: &GitRef, owner: &str, repo: &str) -> Option<String> {
    match &head.repo {
        Some(r) if r.full_name.eq_ignore_ascii_case(&format!("{owner}/{repo}")) => None,
        Some(r) => r.full_name.split('/').next().map(str::to_string),
        None => {
            let label_owner = head.label.as_deref()?.split(':').next()?;
            (!label_owner.is_empty() && !label_owner.eq_ignore_ascii_case(owner))
                .then(|| label_owner.to_string())
        }
    }
}

async fn assemble_review_item(
    client: &GithubClient,
    db: &Db,
    cache: &SessionCache,
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
    // CODEOWNERS stake for the "owner" badge. Non-critical failures (e.g. a
    // 404 on the files endpoint) just leave the badge off; the detail pane's
    // Files block retries on its own when the PR is opened.
    let code_ownership = match resolve_code_ownership(
        client, db, cache, &owner, &repo, num, &pull, username,
    )
    .await
    {
        Ok(summary) => Some(summary),
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
            head_ref: pull.head.git_ref.clone(),
            head_fork_owner: head_fork_owner(&pull.head, &owner, &repo),
            head_sha: Some(pull.head.sha.clone()),
            base_ref: pull.base.as_ref().and_then(|b| b.git_ref.clone()),
            base_sha: pull.base.as_ref().map(|b| b.sha.clone()),
            code_ownership,
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

#[allow(clippy::too_many_arguments)] // mirrors the assembler's own argument list
async fn resolve_code_ownership(
    client: &GithubClient,
    db: &Db,
    cache: &SessionCache,
    owner: &str,
    repo: &str,
    num: i64,
    pull: &PullDetail,
    username: &str,
) -> BeetResult<CodeOwnership> {
    let pr = PrRef {
        owner: owner.to_string(),
        repo: repo.to_string(),
        number: num,
        head_sha: Some(pull.head.sha.clone()),
        base_ref: pull.base.as_ref().and_then(|b| b.git_ref.clone()),
        base_sha: pull.base.as_ref().map(|b| b.sha.clone()),
    };
    let result = fetch_pr_files(client, db, cache, pr, username).await?;
    Ok(CodeOwnership::from(&result))
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
            head_ref: pull.head.git_ref.clone(),
            head_fork_owner: head_fork_owner(&pull.head, &owner, &repo),
            head_sha: Some(pull.head.sha.clone()),
            base_ref: pull.base.as_ref().and_then(|b| b.git_ref.clone()),
            base_sha: pull.base.as_ref().map(|b| b.sha.clone()),
            code_ownership: None,
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
    }))
}

#[cfg(test)]
#[path = "__tests__/prs.rs"]
mod tests;
