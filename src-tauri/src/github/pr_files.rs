//! Changed files of a PR + which of them the user owns via CODEOWNERS.
//!
//! Used two ways:
//! - during polling, for every review request, to attach the compact
//!   `CodeOwnership` summary that drives the "owner" badge;
//! - on demand from the detail pane (`fetch_pr_files_command`), for the full
//!   per-file list in the Files block.
//!
//! Both paths share the ETag cache (files keyed by head SHA) and the session
//! cache (CODEOWNERS keyed by base SHA, user teams once), so opening a review
//! request the poller already saw costs only 304s.

use crate::error::BeetResult;
use crate::github::client::GithubClient;
use crate::github::codeowners::{is_owned_by, owners_for, Codeowners};
use crate::github::models::{PullDetail, PullFileRow};
use crate::github::session_cache::{SessionCache, UserTeams};
use crate::poller::types::CodeOwnership;
use crate::store::Db;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::Arc;

/// GitHub stops listing files at 3,000 per PR.
pub const MAX_FILES: usize = 3000;
const FILES_PER_PAGE: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrChangedFile {
    /// New path (renames match CODEOWNERS on the new path).
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_path: Option<String>,
    /// `added | modified | removed | renamed | copied | changed | unchanged`.
    pub status: String,
    pub additions: i64,
    pub deletions: i64,
    /// Owner tokens from the winning CODEOWNERS rule, as written.
    pub owners: Vec<String>,
    pub owned_by_me: bool,
    /// `diff-<sha256(path)>` — the fragment github.com uses on the Files tab.
    pub anchor: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrFilesResult {
    pub files: Vec<PrChangedFile>,
    pub has_codeowners: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codeowners_path: Option<String>,
    pub teams_resolved: bool,
    pub owned_count: usize,
    pub total_count: usize,
    pub truncated: bool,
    /// Authenticated login, for GitHub's `owned-by[]` deep link.
    pub username: String,
}

/// Identifies a PR for `fetch_pr_files`. The SHAs / base ref are optional so
/// items persisted before they were tracked still work (one extra `pulls.get`).
#[derive(Debug, Clone)]
pub struct PrRef {
    pub owner: String,
    pub repo: String,
    pub number: i64,
    pub head_sha: Option<String>,
    pub base_ref: Option<String>,
    pub base_sha: Option<String>,
}

pub fn diff_anchor(path: &str) -> String {
    let digest = Sha256::digest(path.as_bytes());
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    format!("diff-{hex}")
}

/// `GET /repos/{o}/{r}/pulls/{n}/files`, paginated by page number (the client
/// doesn't expose `Link` headers, and a short page is an unambiguous end).
/// Returns `(files, truncated)`; `truncated` is set when GitHub's cap was hit.
pub async fn fetch_changed_files(
    client: &GithubClient,
    db: &Db,
    owner: &str,
    repo: &str,
    number: i64,
    head_sha: &str,
) -> BeetResult<(Vec<PullFileRow>, bool)> {
    let mut files = Vec::new();
    let max_pages = MAX_FILES / FILES_PER_PAGE;
    for page in 1..=max_pages {
        let url = client.url(&format!(
            "/repos/{owner}/{repo}/pulls/{number}/files?per_page={FILES_PER_PAGE}&page={page}"
        ));
        let cache_key = format!("prfiles:{owner}/{repo}#{number}@{head_sha}:page{page}");
        let rows = client
            .beet_get::<Vec<PullFileRow>>(db, &cache_key, &url)
            .await?
            .body;
        let n = rows.len();
        files.extend(rows);
        if n < FILES_PER_PAGE {
            return Ok((files, false));
        }
    }
    files.truncate(MAX_FILES);
    Ok((files, true))
}

/// Pure: match every file against CODEOWNERS and tally the user's stake.
pub fn assemble(
    files: Vec<PullFileRow>,
    truncated: bool,
    codeowners: Option<&Codeowners>,
    username: &str,
    teams: &UserTeams,
) -> PrFilesResult {
    let files: Vec<PrChangedFile> = files
        .into_iter()
        .map(|f| {
            let owners: Vec<String> = codeowners
                .and_then(|co| owners_for(&co.rules, &f.filename))
                .map(|o| o.to_vec())
                .unwrap_or_default();
            let owned_by_me = is_owned_by(&owners, username, &teams.teams);
            PrChangedFile {
                anchor: diff_anchor(&f.filename),
                path: f.filename,
                previous_path: f.previous_filename,
                status: f.status,
                additions: f.additions,
                deletions: f.deletions,
                owners,
                owned_by_me,
            }
        })
        .collect();
    let owned_count = files.iter().filter(|f| f.owned_by_me).count();
    PrFilesResult {
        owned_count,
        total_count: files.len(),
        files,
        has_codeowners: codeowners.is_some(),
        codeowners_path: codeowners.map(|co| co.path.clone()),
        teams_resolved: teams.resolved,
        truncated,
        username: username.to_string(),
    }
}

impl From<&PrFilesResult> for CodeOwnership {
    fn from(r: &PrFilesResult) -> Self {
        CodeOwnership {
            owned_count: r.owned_count,
            total_count: r.total_count,
            has_codeowners: r.has_codeowners,
            teams_resolved: r.teams_resolved,
        }
    }
}

/// Resolve the full Files-block payload for one PR. Fills in missing head /
/// base refs from `pulls.get` (an ETag 304 whenever the poller has seen the
/// PR). If the base is still unknown, CODEOWNERS is skipped rather than read
/// from the head branch, which the PR author controls. Errors propagate
/// unclassified: the poll loop swallows non-critical ones per item, the
/// command surfaces them to the pane.
pub async fn fetch_pr_files(
    client: &GithubClient,
    db: &Db,
    cache: &SessionCache,
    pr: PrRef,
    username: &str,
) -> BeetResult<PrFilesResult> {
    let PrRef {
        owner,
        repo,
        number,
        head_sha,
        base_ref,
        base_sha,
    } = pr;
    let (head_sha, base) = match (head_sha, base_ref, base_sha) {
        (Some(h), Some(r), Some(s)) => (h, Some((r, s))),
        _ => {
            let url = client.url(&format!("/repos/{owner}/{repo}/pulls/{number}"));
            let key = format!("pr:{owner}/{repo}#{number}:detail");
            let pull = client.beet_get::<PullDetail>(db, &key, &url).await?.body;
            let base = pull.base.and_then(|b| b.git_ref.map(|r| (r, b.sha)));
            (pull.head.sha, base)
        }
    };

    let codeowners = async {
        match &base {
            Some((base_ref, base_sha)) => {
                cache
                    .codeowners(client, db, &owner, &repo, base_ref, base_sha)
                    .await
            }
            None => Ok(Arc::new(None)),
        }
    };
    let (files, codeowners, teams) = tokio::join!(
        fetch_changed_files(client, db, &owner, &repo, number, &head_sha),
        codeowners,
        cache.user_teams(client, db),
    );
    let (files, truncated) = files?;
    let codeowners = codeowners?;
    let teams = teams?;
    Ok(assemble(
        files,
        truncated,
        codeowners.as_ref().as_ref(),
        username,
        &teams,
    ))
}

/// Tauri command behind the detail pane's Files block. Reads the PAT per call
/// like `fetch_run_jobs_command` (user-initiated, infrequent).
#[tauri::command]
#[allow(clippy::too_many_arguments)] // one arg per invoke field
pub async fn fetch_pr_files_command(
    db: tauri::State<'_, Arc<Db>>,
    cache: tauri::State<'_, Arc<SessionCache>>,
    owner: String,
    repo: String,
    number: i64,
    head_sha: Option<String>,
    base_ref: Option<String>,
    base_sha: Option<String>,
) -> Result<PrFilesResult, String> {
    if crate::mock::is_enabled() {
        return Ok(crate::mock::mock_pr_files(number));
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
    let pr = PrRef {
        owner,
        repo,
        number,
        head_sha,
        base_ref,
        base_sha,
    };
    fetch_pr_files(&client, db.inner(), cache.inner(), pr, &username)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "__tests__/pr_files.rs"]
mod tests;
