//! Mentions hybrid (#25 / SPECS §7). The notifications inbox is the primary
//! signal: `fetch_notifications` polls it (ETag-cached) and
//! `route_notifications` turns each unread thread into a per-PR event that
//! `apply_activity` folds into `pr.activity`. Per-PR comment bodies are only
//! fetched on demand for the detail pane (`fetch_pr_comments_command`).

use crate::error::BeetResult;
use crate::github::client::GithubClient;
use crate::github::models::{FullCommentRow, NotificationThread};
use crate::poller::types::{ActionableItem, PrActivity};
use crate::store::Db;
use futures::stream::{self, StreamExt};
use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock};

/// Upper bound on concurrent reply-to-review lookups.
const MAX_REPLY_CONCURRENCY: usize = 4;

/// Page size for the comment endpoints (GitHub's max).
const COMMENTS_PER_PAGE: usize = 100;

/// Cap on pages walked per comment endpoint for the Activity block — 1000
/// comments is well past anything worth rendering in the detail pane.
const MAX_COMMENT_PAGES: usize = 10;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NotificationEvent {
    /// `reason = mention | team_mention` on a PR thread.
    Mention { pr_id: String },
    /// A reply landed on a review thread I started.
    ReplyToMyReview { pr_id: String },
}

/// A `reason = comment | author` PR thread that might be a reply to my review.
/// Needs a review-comments lookup to confirm (`resolve_reply_candidates`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommentCandidate {
    pub pr_id: String,
    pub owner: String,
    pub repo: String,
    pub number: i64,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct RoutedNotifications {
    pub events: Vec<NotificationEvent>,
    pub comment_candidates: Vec<CommentCandidate>,
}

/// Unread inbox threads, most recently updated first. `all=false` returns
/// unread threads only, so a mention stops counting once the user reads it on
/// GitHub. One page of 100 (GitHub's max) — paging deeper into a backlog of
/// stale unread threads isn't worth a request per poll.
pub async fn fetch_notifications(
    client: &GithubClient,
    db: &Db,
) -> BeetResult<Vec<NotificationThread>> {
    let url = client.url("/notifications?all=false&participating=false&per_page=100");
    let res = client
        .beet_get::<Vec<NotificationThread>>(db, "notifications:inbox", &url)
        .await?;
    Ok(res.body)
}

/// Parse `https://api.github.com/repos/{owner}/{repo}/pulls/{number}` into its
/// coordinates. Anything else (issues, commits, releases) is `None`.
pub fn parse_pr_subject_url(url: &str) -> Option<(String, String, i64)> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE
        .get_or_init(|| Regex::new(r"/repos/([^/]+)/([^/]+)/pulls/(\d+)$").expect("static regex"));
    let caps = re.captures(url)?;
    let number = caps[3].parse().ok()?;
    Some((caps[1].to_string(), caps[2].to_string(), number))
}

fn pr_id(owner: &str, repo: &str, number: i64) -> String {
    format!("pr:{owner}/{repo}#{number}")
}

/// Route unread threads by `reason`. `comment` (a thread I'm subscribed to)
/// and `author` (activity on my own PR — GitHub uses it instead of `comment`
/// there) become reply candidates. `review_requested` is dropped — the
/// review-requests search already covers it — as is anything not on a PR.
pub fn route_notifications(threads: &[NotificationThread]) -> RoutedNotifications {
    let mut out = RoutedNotifications::default();
    for thread in threads {
        if thread.subject.kind != "PullRequest" {
            continue;
        }
        let Some((owner, repo, number)) =
            thread.subject.url.as_deref().and_then(parse_pr_subject_url)
        else {
            continue;
        };
        let id = pr_id(&owner, &repo, number);
        match thread.reason.as_str() {
            "mention" | "team_mention" => out.events.push(NotificationEvent::Mention { pr_id: id }),
            "comment" | "author" => out.comment_candidates.push(CommentCandidate {
                pr_id: id,
                owner,
                repo,
                number,
            }),
            _ => {}
        }
    }
    out
}

/// Reply-to-review heuristic: some review thread I commented in has a newest
/// comment by someone else. Threads are grouped by `in_reply_to_id` (GitHub
/// points every reply at the thread's root comment), and "newest" is by
/// `created_at`, so editing an old comment of mine doesn't mask a reply.
/// Replies on threads I never joined don't count.
pub fn is_reply_to_my_review(comments: &[FullCommentRow], username: &str) -> bool {
    // thread root id → (I participated, newest comment)
    let mut threads: HashMap<i64, (bool, &FullCommentRow)> = HashMap::new();
    for c in comments {
        let root = c.in_reply_to_id.unwrap_or(c.id);
        let entry = threads.entry(root).or_insert((false, c));
        entry.0 |= is_mine(c, username);
        if (c.created_at.as_str(), c.id) > (entry.1.created_at.as_str(), entry.1.id) {
            entry.1 = c;
        }
    }
    threads
        .values()
        .any(|(participated, newest)| *participated && !is_mine(newest, username))
}

fn is_mine(comment: &FullCommentRow, username: &str) -> bool {
    comment
        .user
        .as_ref()
        .is_some_and(|u| u.login.eq_ignore_ascii_case(username))
}

/// Confirm `comment` candidates for tracked PRs only, one ETag-cached
/// review-comments call each. Lookup failures drop the candidate.
pub async fn resolve_reply_candidates(
    client: &GithubClient,
    db: &Db,
    candidates: Vec<CommentCandidate>,
    tracked_ids: &HashSet<String>,
    username: &str,
) -> Vec<NotificationEvent> {
    let mut seen = HashSet::new();
    let candidates: Vec<CommentCandidate> = candidates
        .into_iter()
        .filter(|c| tracked_ids.contains(&c.pr_id) && seen.insert(c.pr_id.clone()))
        .collect();

    stream::iter(candidates)
        .map(|c| async move {
            let url = client.url(&format!(
                "/repos/{}/{}/pulls/{}/comments?sort=updated&direction=desc&per_page=100",
                c.owner, c.repo, c.number
            ));
            let key = format!("pr-review-comments-latest:{}", c.pr_id);
            match client.beet_get::<Vec<FullCommentRow>>(db, &key, &url).await {
                Ok(res) if is_reply_to_my_review(&res.body, username) => {
                    Some(NotificationEvent::ReplyToMyReview { pr_id: c.pr_id })
                }
                _ => None,
            }
        })
        .buffer_unordered(MAX_REPLY_CONCURRENCY)
        .filter_map(|e| async move { e })
        .collect()
        .await
}

/// Fold inbox events into `pr.activity` on the matching PR items. Events for
/// PRs that aren't in `items` are dropped; items with no events keep
/// `activity = None`.
pub fn apply_activity(items: &mut [ActionableItem], events: &[NotificationEvent]) {
    let mut counts: HashMap<&str, PrActivity> = HashMap::new();
    for event in events {
        match event {
            NotificationEvent::Mention { pr_id } => {
                counts.entry(pr_id).or_default().mentions_me += 1;
            }
            NotificationEvent::ReplyToMyReview { pr_id } => {
                counts.entry(pr_id).or_default().reply_to_my_review += 1;
            }
        }
    }
    for item in items.iter_mut() {
        if let (Some(pr), Some(activity)) = (item.pr.as_mut(), counts.get(item.id.as_str())) {
            pr.activity = Some(activity.clone());
        }
    }
}

/// One comment in the detail pane's Activity block.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrComment {
    pub id: i64,
    /// `"issue"` (conversation tab) or `"review"` (inline diff comment).
    pub kind: &'static str,
    pub author: String,
    pub body: String,
    pub created_at: String,
    pub html_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub in_reply_to_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrCommentsResult {
    pub comments: Vec<PrComment>,
    /// Authenticated login, so the frontend can highlight `@me`.
    pub username: String,
}

fn to_pr_comment(row: FullCommentRow, kind: &'static str) -> PrComment {
    PrComment {
        id: row.id,
        kind,
        author: row.user.map(|u| u.login).unwrap_or_default(),
        body: row.body.unwrap_or_default(),
        created_at: row.created_at,
        html_url: row.html_url,
        in_reply_to_id: row.in_reply_to_id,
        path: row.path,
    }
}

/// Merge issue + review comments into one oldest-first list.
pub fn merge_comments(issue: Vec<FullCommentRow>, review: Vec<FullCommentRow>) -> Vec<PrComment> {
    let mut out: Vec<PrComment> = issue
        .into_iter()
        .map(|r| to_pr_comment(r, "issue"))
        .chain(review.into_iter().map(|r| to_pr_comment(r, "review")))
        .collect();
    out.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
    out
}

/// Walk one comment endpoint page by page (each page ETag-cached) until a
/// short page or `MAX_COMMENT_PAGES`. Both endpoints list oldest-first, so a
/// single page would drop the newest comments on a busy PR.
async fn fetch_comment_pages(
    client: &GithubClient,
    db: &Db,
    path: &str,
    cache_prefix: &str,
) -> BeetResult<Vec<FullCommentRow>> {
    let mut rows = Vec::new();
    for page in 1..=MAX_COMMENT_PAGES {
        let url = client.url(&format!("{path}?per_page={COMMENTS_PER_PAGE}&page={page}"));
        let key = format!("{cache_prefix}:page{page}");
        let body = client
            .beet_get::<Vec<FullCommentRow>>(db, &key, &url)
            .await?
            .body;
        let n = body.len();
        rows.extend(body);
        if n < COMMENTS_PER_PAGE {
            break;
        }
    }
    Ok(rows)
}

pub async fn fetch_pr_comments(
    client: &GithubClient,
    db: &Db,
    owner: &str,
    repo: &str,
    number: i64,
) -> BeetResult<Vec<PrComment>> {
    let id = pr_id(owner, repo, number);
    let issue_path = format!("/repos/{owner}/{repo}/issues/{number}/comments");
    let review_path = format!("/repos/{owner}/{repo}/pulls/{number}/comments");
    let issue_key = format!("pr-issue-comments:{id}");
    let review_key = format!("pr-review-comments:{id}");
    let (issue, review) = tokio::join!(
        fetch_comment_pages(client, db, &issue_path, &issue_key),
        fetch_comment_pages(client, db, &review_path, &review_key),
    );
    Ok(merge_comments(issue?, review?))
}

/// Tauri command behind the detail pane's Activity block — the per-PR
/// fallback of the mentions hybrid. Only invoked for the selected PR.
#[tauri::command]
pub async fn fetch_pr_comments_command(
    db: tauri::State<'_, Arc<Db>>,
    owner: String,
    repo: String,
    number: i64,
) -> Result<PrCommentsResult, String> {
    if crate::mock::is_enabled() {
        return Ok(crate::mock::mock_pr_comments(number));
    }
    if !crate::github::runs::is_valid_path_segment(&owner)
        || !crate::github::runs::is_valid_path_segment(&repo)
    {
        return Err("invalid owner or repo".to_string());
    }
    if number <= 0 {
        return Err("invalid PR number".to_string());
    }
    let token = crate::secure_token::read_token()
        .map_err(|e| format!("keyring error: {e}"))?
        .ok_or_else(|| "no PAT configured".to_string())?;
    let client = GithubClient::new(&token).map_err(|e| e.to_string())?;
    let username = crate::poller::poll_loop::fetch_username(&client, db.inner())
        .await
        .map_err(|e| e.to_string())?;
    let comments = fetch_pr_comments(&client, db.inner(), &owner, &repo, number)
        .await
        .map_err(|e| e.to_string())?;
    Ok(PrCommentsResult { comments, username })
}

#[cfg(test)]
#[path = "__tests__/notifications.rs"]
mod tests;
