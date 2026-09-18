//! Per-session in-memory caches shared by the poll loop and the detail-pane
//! command:
//!
//! - the authenticated user's teams (`GET /user/teams`), fetched once per
//!   session because it's the same for every PR and needs `read:org`;
//! - parsed CODEOWNERS files keyed by repo + base SHA. The ETag layer can't
//!   help here: a repo *without* CODEOWNERS answers 404 with no ETag, so
//!   without this map every poll would re-ask three locations per PR.
//!
//! Both are dropped on token rotation (`clear`).

use crate::error::{BeetError, BeetResult};
use crate::github::client::GithubClient;
use crate::github::codeowners::{parse_codeowners, Codeowners};
use crate::github::models::{ContentsFile, UserTeamRow};
use crate::store::Db;
use base64::Engine;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// Where GitHub looks for CODEOWNERS, in precedence order.
pub const CODEOWNERS_LOCATIONS: [&str; 3] = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

const TEAMS_PER_PAGE: usize = 100;
const TEAMS_MAX_PAGES: usize = 20;
/// Bound on the parsed-CODEOWNERS map; well past it we just start over.
const CODEOWNERS_MAX_ENTRIES: usize = 500;

/// Teams the authenticated user belongs to, as lowercase `"org/slug"`.
/// `resolved = false` means the lookup was refused (token lacks `read:org`),
/// so team-owned files can't be attributed to the user.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UserTeams {
    pub teams: HashSet<String>,
    pub resolved: bool,
}

#[derive(Default)]
pub struct SessionCache {
    teams: Mutex<Option<UserTeams>>,
    codeowners: Mutex<HashMap<String, Arc<Option<Codeowners>>>>,
    // Single-flight locks so a fan-out of 8 PRs on the first poll doesn't
    // fire 8 identical fetches. CODEOWNERS locks are per repo + base SHA, so
    // a slow or retrying repo never stalls lookups for other repos.
    teams_fetch: tokio::sync::Mutex<()>,
    codeowners_fetch: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    // Bumped by `clear`. A fetch that started under an older generation (the
    // previous token) returns its answer to its caller but never stores it.
    generation: AtomicU64,
}

impl SessionCache {
    /// Forget everything — called when the PAT is rotated or cleared.
    pub fn clear(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        *lock(&self.teams) = None;
        lock(&self.codeowners).clear();
        lock(&self.codeowners_fetch).clear();
    }

    fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    /// The user's teams, fetched at most once per session. A definitive
    /// refusal (403/404) is cached as `resolved = false`; a rate-limit or
    /// outage is returned as an error and *not* cached, so the next caller
    /// retries.
    pub async fn user_teams(&self, client: &GithubClient, db: &Db) -> BeetResult<UserTeams> {
        if let Some(t) = lock(&self.teams).clone() {
            return Ok(t);
        }
        let _guard = self.teams_fetch.lock().await;
        if let Some(t) = lock(&self.teams).clone() {
            return Ok(t);
        }
        let started = self.generation();
        let fetched = fetch_user_teams(client, db).await?;
        let mut slot = lock(&self.teams);
        if self.generation() == started {
            *slot = Some(fetched.clone());
        }
        Ok(fetched)
    }

    /// Parsed CODEOWNERS for `owner/repo` at `base_sha`, or `None` when the
    /// repo has no CODEOWNERS file. Cached per repo + base SHA for the session.
    pub async fn codeowners(
        &self,
        client: &GithubClient,
        db: &Db,
        owner: &str,
        repo: &str,
        base_ref: &str,
        base_sha: &str,
    ) -> BeetResult<Arc<Option<Codeowners>>> {
        let key = format!("{owner}/{repo}@{base_sha}");
        if let Some(c) = lock(&self.codeowners).get(&key).cloned() {
            return Ok(c);
        }
        let key_lock = lock(&self.codeowners_fetch)
            .entry(key.clone())
            .or_default()
            .clone();
        let _guard = key_lock.lock().await;
        if let Some(c) = lock(&self.codeowners).get(&key).cloned() {
            return Ok(c);
        }
        let started = self.generation();
        let fetched = Arc::new(fetch_codeowners(client, db, owner, repo, base_ref).await?);
        let mut map = lock(&self.codeowners);
        if self.generation() == started {
            if map.len() >= CODEOWNERS_MAX_ENTRIES {
                map.clear();
                lock(&self.codeowners_fetch).retain(|k, _| *k == key);
            }
            map.insert(key, fetched.clone());
        }
        Ok(fetched)
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// `GET /user/teams`, paginated. Needs `read:org`; a 403/404 is reported as
/// `resolved = false` rather than an error because a token without the scope
/// is a supported (degraded) configuration.
pub async fn fetch_user_teams(client: &GithubClient, db: &Db) -> BeetResult<UserTeams> {
    let mut teams = HashSet::new();
    for page in 1..=TEAMS_MAX_PAGES {
        let url = client.url(&format!(
            "/user/teams?per_page={TEAMS_PER_PAGE}&page={page}"
        ));
        let cache_key = format!("user:teams:page{page}");
        let rows = match client
            .beet_get::<Vec<UserTeamRow>>(db, &cache_key, &url)
            .await
        {
            Ok(res) => res.body,
            Err(BeetError::Github {
                status: 403 | 404, ..
            }) => {
                return Ok(UserTeams::default());
            }
            Err(e) => return Err(e),
        };
        let n = rows.len();
        for row in rows {
            if let Some(org) = row.organization {
                teams.insert(format!("{}/{}", org.login, row.slug).to_ascii_lowercase());
            }
        }
        if n < TEAMS_PER_PAGE {
            break;
        }
    }
    Ok(UserTeams {
        teams,
        resolved: true,
    })
}

/// Fetch and parse the base branch's CODEOWNERS, trying GitHub's locations in
/// order. `Ok(None)` when none exists, or when the token can't read repo
/// contents (403, e.g. a fine-grained PAT without Contents:read) — both are
/// definitive for the session, so the caller caches them. Other failures
/// propagate: the caller decides whether they're critical.
pub async fn fetch_codeowners(
    client: &GithubClient,
    db: &Db,
    owner: &str,
    repo: &str,
    base_ref: &str,
) -> BeetResult<Option<Codeowners>> {
    for location in CODEOWNERS_LOCATIONS {
        let url = reqwest::Url::parse_with_params(
            &client.url(&format!("/repos/{owner}/{repo}/contents/{location}")),
            &[("ref", base_ref)],
        )
        .map_err(|e| BeetError::Other(format!("bad contents url: {e}")))?;
        let cache_key = format!("codeowners:{owner}/{repo}@{base_ref}:{location}");
        match client
            .beet_get::<ContentsFile>(db, &cache_key, url.as_str())
            .await
        {
            Ok(res) => {
                let text = decode_contents(&res.body)?;
                return Ok(Some(Codeowners {
                    path: location.to_string(),
                    rules: parse_codeowners(&text),
                }));
            }
            Err(BeetError::Github { status: 404, .. }) => continue,
            // Same token, same answer at every location: stop here.
            Err(BeetError::Github { status: 403, .. }) => return Ok(None),
            Err(e) => return Err(e),
        }
    }
    Ok(None)
}

fn decode_contents(file: &ContentsFile) -> BeetResult<String> {
    if file.encoding != "base64" {
        return Ok(file.content.clone());
    }
    let compact: String = file
        .content
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(compact)
        .map_err(|e| BeetError::Other(format!("CODEOWNERS is not valid base64: {e}")))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(test)]
#[path = "__tests__/session_cache.rs"]
mod tests;
