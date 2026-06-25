//! Workflow-run fetching, collapse-into-PR, and Recently Resolved assembly.
//! Port of `fetchRunsForRepo` / `fetchAllRuns` from Action Jackson's
//! `src/lib/github.ts` (per SPECS §14), adapted to use Beet's ETag cache and
//! the `ActionableItem` contract.
//!
//! SPECS §7 collapse rule: a run whose `pull_requests[]` includes a PR Beet
//! is currently tracking attaches to that PR's `associated_runs` (most recent
//! per workflow name) and does *not* surface as a standalone row. Push-event
//! runs and runs on untracked PRs surface as standalone — branch filtering is
//! deliberately not used; the noise control is the mute list (#9).

use crate::error::BeetResult;
use crate::github::client::{GithubClient, RateLimitInfo};
use crate::github::models::{WorkflowJob, WorkflowJobsResult, WorkflowRun, WorkflowRunsResult};
use crate::poller::types::{ActionableItem, ActionableItemRun, ActionableKind, AssociatedRun};
use crate::secure_token::read_token;
use crate::store::runs::{list_recent_completions, record_completion, RunCompletionEvent};
use crate::store::Db;
use futures::stream::{self, StreamExt};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// Cap concurrent per-repo run fetches. PR fan-out uses 8 ([prs.rs:40]); runs
/// are typically a single call per repo so this can be a bit higher without
/// hammering the rate limit.
const MAX_REPO_CONCURRENCY: usize = 6;

/// Lookback window for Recently Resolved (#6 / SPECS §5).
pub const RECENTLY_RESOLVED_WINDOW_HOURS: i64 = 24;

/// Hard cap on Recently Resolved entries — protects the list from a noisy
/// repo flooding the section after a big batch of merges or run completions.
pub const RECENTLY_RESOLVED_MAX: usize = 50;

/// One repo's runs plus the rate-limit reading from that call.
#[derive(Debug, Clone)]
pub struct FetchedRuns {
    pub runs: Vec<WorkflowRun>,
    pub rate_limit: Option<RateLimitInfo>,
}

/// One workflow run carrying the `owner/repo` it came from. The runs API
/// payload doesn't include the repo on each row, and parsing it back out of
/// `html_url` breaks on GHES; carry it through from the caller instead.
#[derive(Debug, Clone)]
pub struct RunWithRepo {
    pub repo_full_name: String,
    pub run: WorkflowRun,
}

/// Aggregate of all repo fetches.
#[derive(Debug, Default)]
pub struct FetchRunsOutcome {
    pub runs: Vec<RunWithRepo>,
    pub rate_limit: Option<RateLimitInfo>,
}

/// `GET /repos/{owner}/{repo}/actions/runs?actor={actor}&per_page=30` —
/// conditional-cached so a stale list returns 304s for free.
pub async fn fetch_runs_for_repo(
    client: &GithubClient,
    db: &Db,
    owner: &str,
    repo: &str,
    actor: &str,
) -> BeetResult<FetchedRuns> {
    let url = reqwest::Url::parse_with_params(
        &client.url(&format!("/repos/{owner}/{repo}/actions/runs")),
        &[("actor", actor), ("per_page", "30")],
    )
    .map_err(|e| crate::error::BeetError::Other(format!("bad runs url: {e}")))?;
    let cache_key = format!("runs:{owner}/{repo}:actor={actor}");
    let res = client
        .beet_get::<WorkflowRunsResult>(db, &cache_key, url.as_str())
        .await?;
    Ok(FetchedRuns {
        runs: res.body.workflow_runs,
        rate_limit: res.rate_limit,
    })
}

/// Fan out `fetch_runs_for_repo` across a set of `owner/repo` strings. A
/// per-repo failure is swallowed — one broken repo shouldn't take the cycle
/// down — but the error is logged so a persistently broken repo
/// (revoked scope, deleted repo still referenced by an open PR, etc.)
/// leaves a breadcrumb instead of silently disappearing.
pub async fn fetch_runs_for_repos(
    client: &GithubClient,
    db: &Db,
    repos: &[String],
    actor: &str,
) -> FetchRunsOutcome {
    let results: Vec<(String, BeetResult<FetchedRuns>)> = stream::iter(repos.iter().cloned())
        .map(|full_name| async move {
            let res = match full_name.split_once('/') {
                Some((owner, repo)) => fetch_runs_for_repo(client, db, owner, repo, actor).await,
                None => Err(crate::error::BeetError::Other(format!(
                    "bad repo full_name: {full_name}"
                ))),
            };
            (full_name, res)
        })
        .buffer_unordered(MAX_REPO_CONCURRENCY)
        .collect()
        .await;

    let mut runs: Vec<RunWithRepo> = Vec::new();
    let mut rate_limit = None;
    for (repo_full_name, r) in results {
        match r {
            Ok(fetched) => {
                if fetched.rate_limit.is_some() {
                    rate_limit = fetched.rate_limit;
                }
                runs.extend(fetched.runs.into_iter().map(|run| RunWithRepo {
                    repo_full_name: repo_full_name.clone(),
                    run,
                }));
            }
            Err(e) => {
                // No tracing infra in V1 yet; eprintln is enough to surface
                // a persistently broken repo in `tauri dev` output.
                eprintln!("[beet] runs fetch failed for {repo_full_name}: {e}");
            }
        }
    }
    FetchRunsOutcome { runs, rate_limit }
}

/// Frontend-facing job DTO. Mirrored as a TS interface so the contract is
/// stable; camelCase, drop fields that are still `None`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowJobSummary {
    pub id: i64,
    pub name: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conclusion: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html_url: Option<String>,
}

impl From<WorkflowJob> for WorkflowJobSummary {
    fn from(j: WorkflowJob) -> Self {
        Self {
            id: j.id,
            name: j.name,
            status: j.status,
            conclusion: j.conclusion,
            started_at: j.started_at,
            completed_at: j.completed_at,
            html_url: j.html_url,
        }
    }
}

/// On-demand fetch for the RunDetail Jobs block (#6 follow-up). Hits
/// `/repos/{owner}/{repo}/actions/runs/{run_id}/jobs` and caches by ETag like
/// every other GET — clicking the same run twice in a row is free.
pub async fn fetch_run_jobs(
    client: &GithubClient,
    db: &Db,
    owner: &str,
    repo: &str,
    run_id: i64,
) -> BeetResult<Vec<WorkflowJob>> {
    let url = client.url(&format!("/repos/{owner}/{repo}/actions/runs/{run_id}/jobs"));
    let cache_key = format!("runs:{owner}/{repo}#{run_id}:jobs");
    let res = client
        .beet_get::<WorkflowJobsResult>(db, &cache_key, &url)
        .await?;
    Ok(res.body.jobs)
}

/// Validate an `owner` / `repo` path segment before interpolating it into a
/// GitHub API URL. GitHub itself only allows `[A-Za-z0-9._-]` in these
/// segments; rejecting anything else here keeps a misbehaving renderer or
/// malicious markdown-injected `invoke` from sneaking `..` / slashes into the
/// path and reaching unrelated endpoints under the user's PAT.
fn is_valid_path_segment(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

/// Tauri command — exposes `fetch_run_jobs` to the frontend with a simple
/// `Result<Vec<WorkflowJobSummary>, String>` shape. Reads the PAT each call
/// (the poll loop's in-memory cache isn't shared here); commands are
/// user-initiated and infrequent so the extra keychain hit is fine.
#[tauri::command]
pub async fn fetch_run_jobs_command(
    db: tauri::State<'_, Arc<Db>>,
    owner: String,
    repo: String,
    run_id: i64,
) -> Result<Vec<WorkflowJobSummary>, String> {
    if crate::mock::is_enabled() {
        return Ok(crate::mock::mock_run_jobs());
    }
    if !is_valid_path_segment(&owner) || !is_valid_path_segment(&repo) {
        return Err("invalid owner or repo".to_string());
    }
    if run_id <= 0 {
        return Err("invalid run id".to_string());
    }
    let token = read_token()
        .map_err(|e| format!("keyring error: {e}"))?
        .ok_or_else(|| "no PAT configured".to_string())?;
    let client = GithubClient::new(&token).map_err(|e| e.to_string())?;
    let jobs = fetch_run_jobs(&client, db.inner(), &owner, &repo, run_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(jobs.into_iter().map(WorkflowJobSummary::from).collect())
}

/// Convert a run into the standalone-row payload Beet emits.
fn to_actionable_run(run: &WorkflowRun, repo_full_name: &str, actor: &str) -> ActionableItem {
    let workflow_name = display_workflow_name(run);
    ActionableItem {
        id: format!("run:{repo_full_name}#{}", run.id),
        kind: ActionableKind::StandaloneRun,
        title: workflow_name.clone(),
        url: run.html_url.clone(),
        repo_full_name: repo_full_name.to_string(),
        updated_at: run.updated_at.clone(),
        unread: true,
        dismissed_until_fingerprint: None,
        pr: None,
        run: Some(ActionableItemRun {
            workflow_name,
            event: run.event.clone(),
            status: run.status.clone(),
            conclusion: run.conclusion.clone(),
            branch: run.head_branch.clone(),
            sha: run.head_sha.clone(),
            run_number: run.run_number,
            actor_login: run
                .actor
                .as_ref()
                .and_then(|a| a.login.clone())
                .unwrap_or_else(|| actor.to_string()),
            run_url: run.html_url.clone(),
            started_at: run
                .run_started_at
                .clone()
                .or_else(|| Some(run.created_at.clone())),
            completed_at: if run.status == "completed" {
                Some(run.updated_at.clone())
            } else {
                None
            },
        }),
    }
}

fn display_workflow_name(run: &WorkflowRun) -> String {
    run.name
        .clone()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| run.display_title.clone())
        .unwrap_or_else(|| format!("Run #{}", run.run_number))
}

/// Result of the collapse pass.
#[derive(Debug, Default)]
pub struct CollapseOutcome {
    /// `pr_id` → most-recent run per workflow name.
    pub attached: HashMap<String, Vec<AssociatedRun>>,
    /// Runs that didn't collapse into any tracked PR.
    pub standalone: Vec<ActionableItem>,
}

/// Apply SPECS §7's collapse rule. `tracked_prs` maps `pr_id` →
/// `(owner, repo, number)` for every PR currently in `review_requests` ∪
/// `in_flight`. A run matches a tracked PR when its `pull_requests[]`
/// references the same `(repo, number)`; ties (multiple matches) attach to
/// every matching PR. `actor_fallback` is the authenticated login, used when
/// a run payload doesn't include an actor.
pub fn collapse_runs(
    runs: Vec<RunWithRepo>,
    tracked_prs: &HashMap<String, (String, String, i64)>,
    actor_fallback: &str,
) -> CollapseOutcome {
    // Reverse index by (owner/repo, number) → pr_id.
    let by_repo_number: HashMap<(String, i64), String> = tracked_prs
        .iter()
        .map(|(pr_id, (owner, repo, num))| ((format!("{owner}/{repo}"), *num), pr_id.clone()))
        .collect();

    // Per-PR map of workflow_name → most-recent associated run.
    let mut per_pr: HashMap<String, HashMap<String, AssociatedRun>> = HashMap::new();
    let mut per_pr_seen_at: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut standalone: Vec<ActionableItem> = Vec::new();

    for RunWithRepo {
        repo_full_name,
        run,
    } in runs
    {
        // Find every tracked PR this run claims.
        let matched: Vec<&String> = run
            .pull_requests
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .filter_map(|pr| by_repo_number.get(&(repo_full_name.clone(), pr.number)))
            .collect();

        if matched.is_empty() {
            standalone.push(to_actionable_run(&run, &repo_full_name, actor_fallback));
            continue;
        }

        let assoc = AssociatedRun {
            workflow_name: display_workflow_name(&run),
            status: run.status.clone(),
            conclusion: run.conclusion.clone(),
            run_url: run.html_url.clone(),
            completed_at: if run.status == "completed" {
                Some(run.updated_at.clone())
            } else {
                None
            },
        };
        for pr_id in matched {
            let bucket = per_pr.entry(pr_id.clone()).or_default();
            let seen = per_pr_seen_at.entry(pr_id.clone()).or_default();
            let prev_at = seen.get(&assoc.workflow_name).cloned();
            // Keep the most-recent run per workflow name (by `updated_at`).
            if prev_at
                .as_deref()
                .map_or(true, |p| run.updated_at.as_str() > p)
            {
                seen.insert(assoc.workflow_name.clone(), run.updated_at.clone());
                bucket.insert(assoc.workflow_name.clone(), assoc.clone());
            }
        }
    }

    // Flatten per-PR maps and sort runs by workflow name for stable output.
    let attached: HashMap<String, Vec<AssociatedRun>> = per_pr
        .into_iter()
        .map(|(pr_id, by_name)| {
            let mut runs: Vec<AssociatedRun> = by_name.into_values().collect();
            runs.sort_by(|a, b| a.workflow_name.cmp(&b.workflow_name));
            (pr_id, runs)
        })
        .collect();

    CollapseOutcome {
        attached,
        standalone,
    }
}

/// Reduce a list of standalone-run rows to at most one per
/// `(repo_full_name, workflow_name)`, keeping the row with the newest
/// `updated_at`. The output is then sorted newest-first to match the section's
/// existing display order (the frontend stable-sorts again, but a tied
/// timestamp keeps the order set here).
///
/// Noise control for the Standalone Runs section (#6 follow-up): a workflow
/// that fires on every push would otherwise pile up all 30 runs the API
/// returns per page; the user only ever wants the latest.
pub fn dedupe_standalone(runs: Vec<ActionableItem>) -> Vec<ActionableItem> {
    let mut newest: HashMap<(String, String), ActionableItem> = HashMap::new();
    for item in runs {
        let Some(run) = item.run.as_ref() else {
            continue;
        };
        let key = (item.repo_full_name.clone(), run.workflow_name.clone());
        match newest.get(&key) {
            Some(existing) if existing.updated_at >= item.updated_at => {}
            _ => {
                newest.insert(key, item);
            }
        }
    }
    let mut out: Vec<ActionableItem> = newest.into_values().collect();
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    out
}

/// Per-repo workflow allowlist for the Standalone Runs section. For each row,
/// look up the row's `repo_full_name` in `allowlist`:
///
/// - Repo missing from the map, OR present with an empty list → keep (no filter).
/// - Repo present with a non-empty list → keep only when the row's workflow
///   name is in the list (case-insensitive trim compare).
///
/// PR-attached runs (`associated_runs`) are not touched — they're scoped to a
/// single PR and the user has already opted-in to that PR.
pub fn apply_standalone_allowlist(
    runs: Vec<ActionableItem>,
    allowlist: &HashMap<String, Vec<String>>,
) -> Vec<ActionableItem> {
    if allowlist.is_empty() {
        return runs;
    }
    runs.into_iter()
        .filter(|item| {
            let Some(list) = allowlist.get(&item.repo_full_name) else {
                return true;
            };
            if list.is_empty() {
                return true;
            }
            let Some(run) = item.run.as_ref() else {
                return true;
            };
            let needle = run.workflow_name.trim().to_ascii_lowercase();
            list.iter().any(|w| w.trim().to_ascii_lowercase() == needle)
        })
        .collect()
}

/// Persist a `(run_id) → terminal status` row for every completed run we
/// observed, snapshotting the bits we need to render the Recently Resolved
/// row faithfully after the run is no longer in the live poll set
/// (event/sha/run_number/actor_login/run_url/branch). Called after collapse
/// so we record runs we collapsed too — a run that landed on a tracked PR
/// can still appear in Recently Resolved once the PR closes.
///
/// Note: `concluded_at = run.updated_at`. The GitHub Actions runs endpoint
/// doesn't expose a dedicated terminal timestamp; once `status == completed`,
/// `updated_at` is the de-facto conclusion time. A re-run resets `status`
/// back to `queued`/`in_progress`, so we won't accidentally record a stale
/// timestamp for a re-run that's still in flight.
pub fn record_completed_runs(db: &Db, runs: &[(RunWithRepo, Option<i64>)]) {
    let Ok(conn) = db.lock() else { return };
    for (with_repo, pr_number) in runs {
        let run = &with_repo.run;
        if run.status != "completed" {
            continue;
        }
        let _ = record_completion(
            &conn,
            &RunCompletionEvent {
                run_id: run.id,
                repo: with_repo.repo_full_name.clone(),
                workflow_name: display_workflow_name(run),
                conclusion: run.conclusion.clone(),
                concluded_at: run.updated_at.clone(),
                pr_number: *pr_number,
                event: Some(run.event.clone()),
                sha: Some(run.head_sha.clone()),
                run_number: Some(run.run_number),
                actor_login: run.actor.as_ref().and_then(|a| a.login.clone()),
                run_url: Some(run.html_url.clone()),
                branch: run.head_branch.clone(),
            },
        );
    }
}

/// Build the Recently Resolved section (#6 / SPECS §5).
///
/// Combines:
/// - PRs whose latest lifecycle is `merged` or `closed` within the window
///   (sourced by the caller from `pr_lifecycle_history` + the current PR set).
/// - Completed workflow runs from `run_completion_events` not already
///   represented by their parent PR.
///
/// Sorted by resolution time desc; capped at `RECENTLY_RESOLVED_MAX`.
pub fn build_recently_resolved(
    resolved_prs: Vec<(ActionableItem, String)>, // (item, resolved_at)
    db: &Db,
    since_iso: &str,
) -> Vec<ActionableItem> {
    // Collect a set of (repo, pr_number) we've already represented via a PR
    // row, so we don't double-list a run that closed alongside its PR.
    let pr_repo_numbers: HashSet<(String, i64)> = resolved_prs
        .iter()
        .filter_map(|(item, _)| {
            item.pr
                .as_ref()
                .map(|pr| (item.repo_full_name.clone(), pr.number))
        })
        .collect();

    let completions = match db.lock() {
        Ok(conn) => list_recent_completions(&conn, since_iso).unwrap_or_default(),
        Err(_) => Vec::new(),
    };

    let mut entries: Vec<(String, ActionableItem)> = Vec::new();
    for (item, resolved_at) in resolved_prs {
        entries.push((resolved_at, item));
    }
    for ev in completions {
        if let Some(pr_num) = ev.pr_number {
            if pr_repo_numbers.contains(&(ev.repo.clone(), pr_num)) {
                continue;
            }
        }
        entries.push((ev.concluded_at.clone(), completion_to_item(ev)));
    }
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    entries
        .into_iter()
        .take(RECENTLY_RESOLVED_MAX)
        .map(|(_, item)| item)
        .collect()
}

fn completion_to_item(ev: RunCompletionEvent) -> ActionableItem {
    let id = format!("run:{}#{}", ev.repo, ev.run_id);
    let fallback_url = format!("https://github.com/{}/actions/runs/{}", ev.repo, ev.run_id);
    let run_url = ev.run_url.clone().unwrap_or_else(|| fallback_url.clone());
    ActionableItem {
        id,
        kind: ActionableKind::StandaloneRun,
        title: ev.workflow_name.clone(),
        url: run_url.clone(),
        repo_full_name: ev.repo,
        updated_at: ev.concluded_at.clone(),
        unread: false,
        dismissed_until_fingerprint: None,
        pr: None,
        run: Some(ActionableItemRun {
            workflow_name: ev.workflow_name,
            event: ev.event.unwrap_or_default(),
            status: "completed".to_string(),
            conclusion: ev.conclusion,
            branch: ev.branch,
            sha: ev.sha.unwrap_or_default(),
            run_number: ev.run_number.unwrap_or(0),
            actor_login: ev.actor_login.unwrap_or_default(),
            run_url,
            started_at: None,
            completed_at: Some(ev.concluded_at),
        }),
    }
}

/// `(now - hours) → ISO-8601 millisecond Z` for use as a `since` argument.
pub fn iso_window_start(hours: i64) -> String {
    use chrono::SecondsFormat;
    let cutoff = chrono::Utc::now() - chrono::Duration::hours(hours);
    cutoff.to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::models::RunPullRequestRef;

    fn run(
        id: i64,
        repo_pr_numbers: &[i64],
        status: &str,
        conclusion: Option<&str>,
        updated_at: &str,
        workflow: &str,
    ) -> WorkflowRun {
        WorkflowRun {
            id,
            name: Some(workflow.into()),
            display_title: None,
            status: status.into(),
            conclusion: conclusion.map(|s| s.into()),
            event: "push".into(),
            html_url: format!("https://github.com/foo/bar/actions/runs/{id}"),
            created_at: updated_at.into(),
            updated_at: updated_at.into(),
            run_started_at: None,
            head_branch: Some("main".into()),
            head_sha: "deadbeef".into(),
            run_number: id,
            actor: None,
            pull_requests: if repo_pr_numbers.is_empty() {
                None
            } else {
                Some(
                    repo_pr_numbers
                        .iter()
                        .map(|n| RunPullRequestRef { number: *n })
                        .collect(),
                )
            },
        }
    }

    fn tracked(pr_id: &str, owner: &str, repo: &str, n: i64) -> (String, (String, String, i64)) {
        (pr_id.to_string(), (owner.to_string(), repo.to_string(), n))
    }

    fn with_repo(repo: &str, run: WorkflowRun) -> RunWithRepo {
        RunWithRepo {
            repo_full_name: repo.to_string(),
            run,
        }
    }

    #[test]
    fn collapse_attaches_runs_to_tracked_prs_and_drops_them_from_standalone() {
        let tracked: HashMap<_, _> = [tracked("pr:foo/bar#1", "foo", "bar", 1)]
            .into_iter()
            .collect();
        let runs = vec![with_repo(
            "foo/bar",
            run(
                10,
                &[1],
                "completed",
                Some("success"),
                "2026-01-01T01:00:00.000Z",
                "CI",
            ),
        )];
        let out = collapse_runs(runs, &tracked, "evan");
        assert_eq!(out.standalone.len(), 0);
        let attached = out.attached.get("pr:foo/bar#1").unwrap();
        assert_eq!(attached.len(), 1);
        assert_eq!(attached[0].workflow_name, "CI");
    }

    #[test]
    fn collapse_keeps_only_most_recent_run_per_workflow_per_pr() {
        let tracked: HashMap<_, _> = [tracked("pr:foo/bar#1", "foo", "bar", 1)]
            .into_iter()
            .collect();
        let runs = vec![
            with_repo(
                "foo/bar",
                run(
                    10,
                    &[1],
                    "completed",
                    Some("failure"),
                    "2026-01-01T00:00:00.000Z",
                    "CI",
                ),
            ),
            with_repo(
                "foo/bar",
                run(
                    11,
                    &[1],
                    "completed",
                    Some("success"),
                    "2026-01-01T02:00:00.000Z",
                    "CI",
                ),
            ),
            with_repo(
                "foo/bar",
                run(
                    12,
                    &[1],
                    "in_progress",
                    None,
                    "2026-01-01T03:00:00.000Z",
                    "Deploy",
                ),
            ),
        ];
        let out = collapse_runs(runs, &tracked, "evan");
        let attached = out.attached.get("pr:foo/bar#1").unwrap();
        assert_eq!(attached.len(), 2);
        let ci = attached.iter().find(|r| r.workflow_name == "CI").unwrap();
        assert_eq!(ci.conclusion.as_deref(), Some("success"));
        let deploy = attached
            .iter()
            .find(|r| r.workflow_name == "Deploy")
            .unwrap();
        assert_eq!(deploy.status, "in_progress");
        assert!(deploy.completed_at.is_none());
    }

    #[test]
    fn collapse_surfaces_orphan_and_push_event_runs_as_standalone() {
        let tracked: HashMap<_, _> = HashMap::new();
        let runs = vec![
            with_repo(
                "foo/bar",
                run(
                    20,
                    &[],
                    "completed",
                    Some("success"),
                    "2026-01-01T00:00:00.000Z",
                    "Deploy",
                ),
            ),
            with_repo(
                "foo/bar",
                run(
                    21,
                    &[999],
                    "in_progress",
                    None,
                    "2026-01-01T00:01:00.000Z",
                    "CI",
                ),
            ),
        ];
        let out = collapse_runs(runs, &tracked, "evan");
        assert_eq!(out.attached.len(), 0);
        assert_eq!(out.standalone.len(), 2);
        for item in &out.standalone {
            assert_eq!(item.kind, ActionableKind::StandaloneRun);
            assert!(item.pr.is_none());
            assert!(item.run.is_some());
            assert!(item.id.starts_with("run:foo/bar#"));
        }
    }

    #[test]
    fn collapse_does_not_match_pr_numbers_across_different_repos() {
        // A PR #1 in foo/bar must not collect a run from baz/qux that also
        // claims pull_requests[].number == 1.
        let tracked: HashMap<_, _> = [tracked("pr:foo/bar#1", "foo", "bar", 1)]
            .into_iter()
            .collect();
        let runs = vec![with_repo(
            "baz/qux",
            run(
                30,
                &[1],
                "completed",
                Some("success"),
                "2026-01-01T00:00:00.000Z",
                "CI",
            ),
        )];
        let out = collapse_runs(runs, &tracked, "evan");
        assert!(out.attached.is_empty());
        assert_eq!(out.standalone.len(), 1);
        assert_eq!(out.standalone[0].repo_full_name, "baz/qux");
    }

    fn standalone(repo: &str, run_id: i64, workflow: &str, updated_at: &str) -> ActionableItem {
        to_actionable_run(
            &run(
                run_id,
                &[],
                "completed",
                Some("success"),
                updated_at,
                workflow,
            ),
            repo,
            "evan",
        )
    }

    #[test]
    fn dedupe_standalone_keeps_newest_per_workflow_per_repo() {
        let runs = vec![
            standalone("foo/bar", 1, "CI", "2026-01-01T00:00:00.000Z"),
            standalone("foo/bar", 2, "CI", "2026-01-02T00:00:00.000Z"), // newest CI
            standalone("foo/bar", 3, "Deploy", "2026-01-01T12:00:00.000Z"),
            standalone("baz/qux", 4, "CI", "2026-01-01T11:00:00.000Z"),
        ];
        let out = dedupe_standalone(runs);
        assert_eq!(out.len(), 3);
        // foo/bar / CI keeps run #2
        let foo_ci = out
            .iter()
            .find(|i| i.repo_full_name == "foo/bar" && i.title == "CI")
            .unwrap();
        assert!(foo_ci.id.ends_with("#2"));
        // baz/qux / CI is independent of foo/bar / CI
        assert!(out.iter().any(|i| i.repo_full_name == "baz/qux"));
        // Sorted newest-first
        for w in out.windows(2) {
            assert!(w[0].updated_at >= w[1].updated_at);
        }
    }

    #[test]
    fn apply_standalone_allowlist_filters_to_listed_workflows_only() {
        let runs = vec![
            standalone("foo/bar", 1, "CI", "2026-01-01T00:00:00.000Z"),
            standalone("foo/bar", 2, "Deploy", "2026-01-02T00:00:00.000Z"),
            standalone("foo/bar", 3, "Lint", "2026-01-01T01:00:00.000Z"),
        ];
        let mut allowlist = HashMap::new();
        allowlist.insert("foo/bar".to_string(), vec!["deploy".to_string()]);
        // case-insensitive trim — "deploy" in config matches "Deploy" run.
        let out = apply_standalone_allowlist(runs, &allowlist);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].title, "Deploy");
    }

    #[test]
    fn apply_standalone_allowlist_passes_through_repos_with_no_entry() {
        let runs = vec![
            standalone("foo/bar", 1, "CI", "2026-01-01T00:00:00.000Z"),
            standalone("baz/qux", 2, "CI", "2026-01-01T00:00:00.000Z"),
        ];
        let mut allowlist = HashMap::new();
        // Only foo/bar is filtered; baz/qux has no entry → pass-through.
        allowlist.insert("foo/bar".to_string(), vec!["Deploy".to_string()]);
        let out = apply_standalone_allowlist(runs, &allowlist);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].repo_full_name, "baz/qux");
    }

    #[test]
    fn apply_standalone_allowlist_empty_entry_is_pass_through() {
        let runs = vec![standalone("foo/bar", 1, "CI", "2026-01-01T00:00:00.000Z")];
        let mut allowlist = HashMap::new();
        allowlist.insert("foo/bar".to_string(), Vec::new());
        let out = apply_standalone_allowlist(runs, &allowlist);
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn apply_standalone_allowlist_empty_map_is_pass_through() {
        let runs = vec![standalone("foo/bar", 1, "CI", "2026-01-01T00:00:00.000Z")];
        let out = apply_standalone_allowlist(runs, &HashMap::new());
        assert_eq!(out.len(), 1);
    }

    #[tokio::test]
    async fn fetch_run_jobs_parses_and_caches() {
        use crate::store::db::open_in_memory;
        use crate::store::etag_cache::get_cached;
        use std::sync::Mutex;
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/repos/foo/bar/actions/runs/42/jobs"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("etag", "\"v1\"")
                    .set_body_json(serde_json::json!({
                        "jobs": [
                            {
                                "id": 100,
                                "name": "build",
                                "status": "completed",
                                "conclusion": "success",
                                "started_at": "2026-01-01T00:00:00Z",
                                "completed_at": "2026-01-01T00:02:00Z",
                                "html_url": "https://github.com/foo/bar/actions/runs/42/job/100"
                            },
                            {
                                "id": 101,
                                "name": "test",
                                "status": "in_progress",
                                "conclusion": null,
                                "started_at": "2026-01-01T00:00:05Z",
                                "completed_at": null,
                                "html_url": null
                            }
                        ]
                    })),
            )
            .mount(&server)
            .await;

        let db: Db = Mutex::new(open_in_memory().unwrap());
        let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
        let jobs = fetch_run_jobs(&client, &db, "foo", "bar", 42)
            .await
            .unwrap();

        assert_eq!(jobs.len(), 2);
        assert_eq!(jobs[0].name, "build");
        assert_eq!(jobs[0].conclusion.as_deref(), Some("success"));
        assert_eq!(jobs[1].status, "in_progress");
        assert!(jobs[1].conclusion.is_none());

        // ETag cache primed under the documented key.
        let conn = db.lock().unwrap();
        let cached = get_cached(&conn, "runs:foo/bar#42:jobs").unwrap().unwrap();
        assert_eq!(cached.etag, "\"v1\"");
    }

    #[test]
    fn iso_window_start_returns_a_past_timestamp() {
        let start = iso_window_start(24);
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        assert!(start < now, "{start} should sort before {now}");
    }
}
