//! Detects PRs that declare AI assistance: `Co-authored-by:` trailers and tool
//! footers in commit messages, AI agent accounts as commit or PR authors, and
//! tool footers in the PR body.
//!
//! Detection is declaration-based, so a miss proves nothing — trailers are
//! opt-in and squash merges often drop them.

use crate::error::BeetResult;
use crate::github::client::GithubClient;
use crate::github::models::{CommitRow, PullDetail};
use crate::poller::types::{AiAssist, AiSource};
use crate::store::Db;

/// GitHub's `pulls/{n}/commits` max page size. Only the first page is read:
/// PRs past 100 commits are rare, and one declaring commit is enough.
const COMMITS_PER_PAGE: usize = 100;

/// One AI tool's fingerprints. Every pattern is lowercase and matched as a
/// substring of the lowercased field.
struct Tool {
    name: &'static str,
    /// GitHub logins of the tool's agent account (PR author, commit author,
    /// committer). Compared exactly, not as a substring.
    logins: &'static [&'static str],
    /// Emails the tool writes into commit identities and trailers.
    emails: &'static [&'static str],
    /// Footers the tool appends to commit messages and PR bodies.
    markers: &'static [&'static str],
    /// Suffixes the tool appends to the git author name.
    author_name_suffixes: &'static [&'static str],
}

const TOOLS: &[Tool] = &[
    Tool {
        name: "Claude",
        logins: &["claude[bot]"],
        emails: &["noreply@anthropic.com"],
        markers: &["generated with [claude code]"],
        author_name_suffixes: &[],
    },
    Tool {
        name: "Copilot",
        logins: &["copilot", "copilot-swe-agent[bot]"],
        emails: &["copilot@users.noreply.github.com"],
        markers: &[],
        author_name_suffixes: &[],
    },
    Tool {
        name: "Cursor",
        logins: &["cursor[bot]", "cursoragent"],
        emails: &["cursoragent@cursor.com"],
        markers: &[],
        author_name_suffixes: &[],
    },
    Tool {
        name: "Devin",
        logins: &["devin-ai-integration[bot]"],
        emails: &["devin-ai-integration[bot]@users.noreply.github.com"],
        markers: &[],
        author_name_suffixes: &[],
    },
    Tool {
        name: "Aider",
        logins: &[],
        emails: &["noreply@aider.chat"],
        markers: &[],
        author_name_suffixes: &["(aider)"],
    },
    Tool {
        name: "Codex",
        logins: &["chatgpt-codex-connector[bot]"],
        emails: &[],
        markers: &[],
        author_name_suffixes: &[],
    },
];

const CO_AUTHOR_PREFIX: &str = "co-authored-by:";

fn login_matches(tool: &Tool, login: Option<&str>) -> bool {
    login.is_some_and(|l| {
        let l = l.to_ascii_lowercase();
        tool.logins.iter().any(|t| *t == l)
    })
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| haystack.contains(n))
}

/// Whether a lowercased commit message declares `tool`: a co-author trailer
/// naming one of its emails, or one of its footers anywhere in the message.
fn message_matches(tool: &Tool, message: &str) -> bool {
    let trailer = message.lines().any(|line| {
        line.trim_start()
            .strip_prefix(CO_AUTHOR_PREFIX)
            .is_some_and(|value| contains_any(value, tool.emails))
    });
    trailer || contains_any(message, tool.markers)
}

fn commit_author_matches(tool: &Tool, commit: &CommitRow) -> bool {
    if login_matches(tool, commit.author.as_ref().map(|u| u.login.as_str()))
        || login_matches(tool, commit.committer.as_ref().map(|u| u.login.as_str()))
    {
        return true;
    }
    let Some(actor) = commit.commit.author.as_ref() else {
        return false;
    };
    let email = actor
        .email
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let name = actor
        .name
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    contains_any(&email, tool.emails)
        || tool
            .author_name_suffixes
            .iter()
            .any(|s| name.trim_end().ends_with(s))
}

/// Pure: the AI tools `pull` and its `commits` declare, or `None`.
pub fn detect(pull: &PullDetail, commits: &[CommitRow]) -> Option<AiAssist> {
    let body = pull.body.as_deref().unwrap_or_default().to_lowercase();
    let messages: Vec<String> = commits
        .iter()
        .map(|c| c.commit.message.to_lowercase())
        .collect();
    let pr_author = pull.user.as_ref().map(|u| u.login.as_str());

    let mut tools = Vec::new();
    let mut sources = Vec::new();
    for tool in TOOLS {
        let mut hits = Vec::new();
        if login_matches(tool, pr_author) {
            hits.push(AiSource::PrAuthor);
        }
        if commits.iter().any(|c| commit_author_matches(tool, c)) {
            hits.push(AiSource::CommitAuthor);
        }
        if messages.iter().any(|m| message_matches(tool, m)) {
            hits.push(AiSource::CommitMessage);
        }
        if contains_any(&body, tool.markers) {
            hits.push(AiSource::PrBody);
        }
        if !hits.is_empty() {
            tools.push(tool.name.to_string());
            sources.extend(hits);
        }
    }
    if tools.is_empty() {
        return None;
    }
    sources.sort();
    sources.dedup();
    Some(AiAssist { tools, sources })
}

/// `GET /repos/{o}/{r}/pulls/{n}/commits`, first page only. Keyed by head SHA
/// so the list is fetched once per push; later polls are ETag 304s.
pub async fn fetch_pr_commits(
    client: &GithubClient,
    db: &Db,
    owner: &str,
    repo: &str,
    number: i64,
    head_sha: &str,
) -> BeetResult<Vec<CommitRow>> {
    let url = client.url(&format!(
        "/repos/{owner}/{repo}/pulls/{number}/commits?per_page={COMMITS_PER_PAGE}"
    ));
    let cache_key = format!("prcommits:{owner}/{repo}#{number}@{head_sha}");
    Ok(client
        .beet_get::<Vec<CommitRow>>(db, &cache_key, &url)
        .await?
        .body)
}

/// Fetch commits and run `detect`. Critical errors (auth, rate limit) bubble
/// up; anything else falls back to the free PR-author / body signals.
pub async fn resolve_ai_assist(
    client: &GithubClient,
    db: &Db,
    owner: &str,
    repo: &str,
    number: i64,
    pull: &PullDetail,
) -> BeetResult<Option<AiAssist>> {
    let commits = match fetch_pr_commits(client, db, owner, repo, number, &pull.head.sha).await {
        Ok(c) => c,
        Err(e) if e.is_critical() => return Err(e),
        Err(_) => Vec::new(),
    };
    Ok(detect(pull, &commits))
}

#[cfg(test)]
#[path = "__tests__/ai_assist.rs"]
mod tests;
