//! Background poll task. Ticks on the configured interval, fetches GitHub state
//! with a bounded fan-out, and emits two events to the frontend:
//!
//! - `poll:result` — finished `ActionableItem` lists + rate limit, per cycle.
//! - `poll:status` — `polling` / `ok` / `error` lifecycle, plus rate-limit flag.
//!
//! Errors and rate-limit pressure cross the boundary as event payload fields;
//! the task itself never panics out.

use crate::error::{BeetError, BeetResult};
use crate::github::client::{GithubClient, RateLimitInfo};
use crate::github::models::AuthUser;
use crate::github::prs::{
    fetch_my_open_prs, fetch_review_requests, AutoRequeueError, FetchMyOpenPrsOptions,
    FetchReviewRequestsOptions,
};
use crate::github::runs::{
    apply_standalone_allowlist, build_recently_resolved, collapse_runs, dedupe_standalone,
    fetch_runs_for_repos, iso_window_start, record_completed_runs, RunWithRepo,
    RECENTLY_RESOLVED_WINDOW_HOURS,
};
use crate::poller::adaptive::{
    effective_interval, is_on_battery, is_window_hidden, AdaptiveSignals,
};
use crate::poller::config::PollConfig;
use crate::poller::types::ActionableItem;
use crate::secure_token::read_token;
use crate::store::db::now_iso;
use crate::store::lifecycle::{list_recently_resolved_pr_ids, PrSnapshot, ResolvedPrRow};
use crate::store::runs::prune_completions_older_than;
use crate::store::Db;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

pub const EVENT_POLL_RESULT: &str = "poll:result";
pub const EVENT_POLL_STATUS: &str = "poll:status";

/// Below this many remaining core-API requests, the cycle reports rate-limit
/// pressure (drives adaptive polling in Phase 5).
const RATE_LIMIT_PRESSURE_THRESHOLD: i64 = 100;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PollResultPayload {
    review_requests: Vec<ActionableItem>,
    in_flight: Vec<ActionableItem>,
    /// Workflow runs the user triggered that did *not* collapse into a
    /// tracked PR (#6 / SPECS §7). Includes push-event runs without a PR.
    standalone_runs: Vec<ActionableItem>,
    /// Merged/closed PRs + completed runs from the last 24h (#6 / SPECS §5).
    /// Capped at `RECENTLY_RESOLVED_MAX`.
    recently_resolved: Vec<ActionableItem>,
    rate_limit: Option<RateLimitInfo>,
    polled_at: String,
    /// Per-cycle auto-requeue mutation failures (#13). Empty in the common
    /// case; populated when `enqueuePullRequest` returned a non-critical error
    /// for a specific PR. The frontend dedupes by `(prId, headSha)` so the
    /// user sees one toast per failure, not one per poll cycle.
    auto_requeue_errors: Vec<AutoRequeueError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PollStatusPayload {
    state: &'static str,
    error: Option<String>,
    rate_limited: bool,
    /// Seconds GitHub asked us to wait before retrying. Set on rate-limit
    /// errors; `None` otherwise. Phase 5 will use it to stretch the interval.
    retry_after_secs: Option<u64>,
}

/// Handle to a running poll loop. `cancel` stops the task; `config_tx` pushes
/// live config updates; `paused_tx` toggles polling on/off; `token_gen_tx`
/// signals that the keychain PAT was rotated and the cache must be dropped.
pub struct PollHandle {
    pub cancel: CancellationToken,
    pub config_tx: watch::Sender<PollConfig>,
    pub paused_tx: watch::Sender<bool>,
    pub token_gen_tx: watch::Sender<u64>,
}

/// Re-read settings from `config.json` and push them to the running poll loop,
/// which wakes immediately for a fresh poll. The frontend calls this after a
/// Settings change so interval / teams / bots / task-regex apply without a
/// restart.
#[tauri::command]
pub fn update_poll_config(
    app: tauri::AppHandle,
    handle: tauri::State<'_, PollHandle>,
) -> Result<(), String> {
    let config = PollConfig::load(&app);
    handle
        .config_tx
        .send(config)
        .map_err(|e| format!("poll loop is not running: {e}"))
}

/// Wake the poll loop for an immediate cycle — backs the TitleBar refresh
/// button. Re-sends the current config; the loop treats any watch update as a
/// wake signal.
#[tauri::command]
pub fn refresh_now(handle: tauri::State<'_, PollHandle>) -> Result<(), String> {
    let current = handle.config_tx.borrow().clone();
    handle
        .config_tx
        .send(current)
        .map_err(|e| format!("poll loop is not running: {e}"))
}

/// Pause or resume polling — backs the TitleBar pause button and the tray
/// popover toggle. While paused the loop performs no cycles until resumed.
///
/// This is the single source of truth for pause state: it updates the poll
/// loop, the tray menu label, and broadcasts `tray:toggle-pause` so every
/// window's Zustand store stays in sync.
#[tauri::command]
pub fn set_poll_paused(
    paused: bool,
    handle: tauri::State<'_, PollHandle>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    handle
        .paused_tx
        .send(paused)
        .map_err(|e| format!("poll loop is not running: {e}"))?;

    // Keep the tray menu item text in sync.
    if let Some(tray_state) = app.try_state::<crate::tray::TrayState>() {
        let label = if paused {
            "Resume polling"
        } else {
            "Pause polling"
        };
        let _ = tray_state.pause_item.set_text(label);
    }

    // Broadcast to all windows so their Zustand stores update.
    use tauri::Emitter;
    let _ = app.emit("tray:toggle-pause", paused);

    Ok(())
}

/// Tell the poll loop the keychain PAT changed (rotated or cleared) so it
/// drops its cached token and re-reads on the next cycle. Called by
/// `storeToken` / `clearToken` on the frontend after the keychain write.
/// Also wakes the loop for an immediate poll with the new credentials.
#[tauri::command]
pub fn notify_token_changed(handle: tauri::State<'_, PollHandle>) -> Result<(), String> {
    let next = handle.token_gen_tx.borrow().wrapping_add(1);
    handle
        .token_gen_tx
        .send(next)
        .map_err(|e| format!("poll loop is not running: {e}"))
}

/// Spawn the poll loop on Tauri's async runtime. Returns immediately.
pub fn spawn<R: Runtime>(app: AppHandle<R>, db: Arc<Db>) -> PollHandle {
    let config = PollConfig::load(&app);
    let (config_tx, config_rx) = watch::channel(config);
    let (paused_tx, paused_rx) = watch::channel(false);
    let (token_gen_tx, token_gen_rx) = watch::channel(0u64);
    let cancel = CancellationToken::new();
    let run_cancel = cancel.clone();
    tauri::async_runtime::spawn(async move {
        run(app, db, config_rx, paused_rx, token_gen_rx, run_cancel).await;
    });
    PollHandle {
        cancel,
        config_tx,
        paused_tx,
        token_gen_tx,
    }
}

async fn run<R: Runtime>(
    app: AppHandle<R>,
    db: Arc<Db>,
    mut config_rx: watch::Receiver<PollConfig>,
    mut paused_rx: watch::Receiver<bool>,
    mut token_gen_rx: watch::Receiver<u64>,
    cancel: CancellationToken,
) {
    // The PAT is cached in-process: reading the macOS keychain prompts the user
    // on every access in unsigned/dev builds, so we read it once and only
    // re-read after a failed cycle, or when `notify_token_changed` bumps the
    // generation counter (covers a rotated PAT from Settings).
    let mut token: Option<String> = None;
    let mut last_token_gen: u64 = *token_gen_rx.borrow();

    loop {
        // `borrow_and_update` marks the current value as seen, so the
        // `changed()` arms below only fire on a *subsequent* update.
        let config = config_rx.borrow_and_update().clone();

        // Drop the cached token if the frontend reported a rotation while we
        // were either polling or sleeping.
        let current_gen = *token_gen_rx.borrow_and_update();
        if current_gen != last_token_gen {
            token = None;
            last_token_gen = current_gen;
        }

        // While paused, run no cycles — just wait for resume (or shutdown).
        if *paused_rx.borrow_and_update() {
            tokio::select! {
                _ = cancel.cancelled() => break,
                changed = paused_rx.changed() => {
                    if changed.is_err() {
                        break;
                    }
                }
            }
            continue;
        }

        // Mock mode: emit the static fixture and skip all GitHub access
        // (no keychain read, no network). The sleep/select below still runs
        // so refresh_now, pause, and shutdown behave normally.
        if crate::mock::is_enabled() {
            emit_status(&app, "polling", None, false, None);
            emit_mock(&app);
            let interval = std::time::Duration::from_secs(config.polling_interval_sec.max(1));
            tokio::select! {
                _ = cancel.cancelled() => break,
                _ = tokio::time::sleep(interval) => {}
                changed = config_rx.changed() => {
                    if changed.is_err() { break; }
                }
                changed = paused_rx.changed() => {
                    if changed.is_err() { break; }
                }
            }
            continue;
        }

        emit_status(&app, "polling", None, false, None);

        if token.is_none() {
            match read_token() {
                Ok(t) => token = t,
                Err(e) => emit_status(
                    &app,
                    "error",
                    Some(format!("keyring error: {e}")),
                    false,
                    None,
                ),
            }
        }

        // Capture each cycle's rate-limit signals so the adaptive interval
        // below can stretch backoff appropriately.
        let (rate_limited, retry_after_secs) =
            match poll_once(&app, &db, &config, token.as_deref()).await {
                Ok(rate_limited) => {
                    emit_status(&app, "ok", None, rate_limited, None);
                    (rate_limited, None)
                }
                Err(err) => {
                    // Don't re-read the keychain on every transient failure —
                    // only when the error looks like the token itself is the
                    // problem.
                    if matches!(err, BeetError::Unauthorized(_) | BeetError::NoToken) {
                        token = None;
                    }
                    let (message, rate_limited, retry_after_secs) = describe_error(&err);
                    emit_status(&app, "error", Some(message), rate_limited, retry_after_secs);
                    (rate_limited, retry_after_secs)
                }
            };

        let has_pinned = db
            .lock()
            .map(|c| crate::store::mute_pin::has_any_pins(&c))
            .unwrap_or(false);
        let interval = effective_interval(&AdaptiveSignals {
            base_secs: config.polling_interval_sec,
            window_hidden: is_window_hidden(&app),
            on_battery: is_on_battery(),
            rate_limited,
            retry_after_secs,
            has_pinned_repos: has_pinned,
        });
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = tokio::time::sleep(interval) => {}
            // A Settings change / refresh pushed via the commands above wakes
            // the loop immediately for a fresh poll.
            changed = config_rx.changed() => {
                if changed.is_err() {
                    break; // sender dropped — app shutting down
                }
            }
            // Pause toggled — loop back to the top, which re-checks paused.
            changed = paused_rx.changed() => {
                if changed.is_err() {
                    break;
                }
            }
            // PAT rotated/cleared — wake to drop the cached token and re-poll
            // with the new credentials.
            changed = token_gen_rx.changed() => {
                if changed.is_err() {
                    break;
                }
            }
        }
    }
}

/// Run one poll cycle. On success emits `poll:result` and returns whether the
/// core rate limit is under pressure.
async fn poll_once<R: Runtime>(
    app: &AppHandle<R>,
    db: &Db,
    config: &PollConfig,
    token: Option<&str>,
) -> BeetResult<bool> {
    let token = token.ok_or(BeetError::NoToken)?;

    let client = GithubClient::new(token)?;
    let username = fetch_username(&client, db).await?;

    let review_opts = FetchReviewRequestsOptions {
        username: username.clone(),
        teams: config.teams.clone(),
        penalized_bots: config.penalized_bots.clone(),
        task_regex: config.task_regex.clone(),
    };
    let my_opts = FetchMyOpenPrsOptions {
        username: username.clone(),
        task_regex: config.task_regex.clone(),
        auto_requeue_enabled: config.auto_requeue_enabled,
        auto_requeue_max_attempts: config.auto_requeue_max_attempts,
        auto_requeue_repos: config.auto_requeue_repos.clone(),
    };

    let (reviews, mine) = tokio::join!(
        fetch_review_requests(&client, db, &review_opts),
        fetch_my_open_prs(&client, db, &my_opts),
    );
    let reviews = reviews?;
    let mut mine = mine?;
    let mut reviews_items = reviews.items;

    // Run pass (#6). Scope the repo scan to repos already represented in the
    // current PR set — push-event runs in those repos surface as Standalone,
    // collapse-eligible runs attach to their PR. This bounds the API cost
    // without an explicit pinned-repo list (which lands in #9).
    let tracked_repos: Vec<String> = {
        let mut seen: HashSet<String> = HashSet::new();
        let mut out = Vec::new();
        for item in reviews_items.iter().chain(mine.items.iter()) {
            if seen.insert(item.repo_full_name.clone()) {
                out.push(item.repo_full_name.clone());
            }
        }
        out
    };
    let tracked_prs: HashMap<String, (String, String, i64)> = reviews_items
        .iter()
        .chain(mine.items.iter())
        .filter_map(|item| {
            let pr = item.pr.as_ref()?;
            let (owner, repo) = item.repo_full_name.split_once('/')?;
            Some((
                item.id.clone(),
                (owner.to_string(), repo.to_string(), pr.number),
            ))
        })
        .collect();

    let (collapsed, runs_rate_limit) = if tracked_repos.is_empty() {
        (crate::github::runs::CollapseOutcome::default(), None)
    } else {
        let outcome = fetch_runs_for_repos(&client, db, &tracked_repos, &username).await;
        let rl = outcome.rate_limit;

        // Persist completion snapshots before collapse consumes the runs.
        let runs_for_record: Vec<(RunWithRepo, Option<i64>)> = outcome
            .runs
            .iter()
            .map(|r| {
                let pr_num = r
                    .run
                    .pull_requests
                    .as_deref()
                    .and_then(|prs| prs.first().map(|p| p.number));
                (r.clone(), pr_num)
            })
            .collect();
        record_completed_runs(db, &runs_for_record);

        let collapsed = collapse_runs(outcome.runs, &tracked_prs, &username);
        (collapsed, rl)
    };

    // Attach associated_runs to PRs in both sections.
    for item in reviews_items.iter_mut().chain(mine.items.iter_mut()) {
        if let Some(runs) = collapsed.attached.get(&item.id) {
            if let Some(pr) = item.pr.as_mut() {
                pr.associated_runs = Some(runs.clone());
            }
        }
    }

    // Standalone-runs noise control: always dedupe to most-recent per
    // (repo, workflow); then apply the user's optional per-repo allowlist.
    let standalone_runs = apply_standalone_allowlist(
        dedupe_standalone(collapsed.standalone),
        &config.standalone_runs_allowlist,
    );

    // Recently Resolved: merged/closed PRs in window + completed runs not
    // already represented by their parent PR. The in-memory PR set only
    // holds *open* PRs by construction — rebuild a closed-PR row from the
    // lifecycle snapshot captured at transition time (#6 follow-up).
    let since = iso_window_start(RECENTLY_RESOLVED_WINDOW_HOURS);
    // Sweep `run_completion_events` rows older than the window — they're
    // unreferenced, and otherwise the table grows monotonically for the
    // lifetime of the install.
    if let Ok(conn) = db.lock() {
        let _ = prune_completions_older_than(&conn, &since);
    }
    let resolved_pr_rows: Vec<ResolvedPrRow> = match db.lock() {
        Ok(conn) => list_recently_resolved_pr_ids(&conn, &since).unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    let resolved_prs: Vec<(ActionableItem, String)> = resolved_pr_rows
        .into_iter()
        .filter_map(|row| {
            let resolved_at = row.resolved_at.clone();
            synthesize_resolved_pr_row(&row.pr_id, row.lifecycle, &resolved_at, &row.snapshot)
                .map(|item| (item, resolved_at))
        })
        .collect();
    let recently_resolved = build_recently_resolved(resolved_prs, db, &since);

    // Prefer a per-PR (core bucket) reading; the search call lives in a separate
    // rate-limit bucket and is not representative. Runs also use the core bucket.
    let rate_limit = mine.rate_limit.or(reviews.rate_limit).or(runs_rate_limit);
    let rate_limited = rate_limit.is_some_and(|rl| rl.remaining < RATE_LIMIT_PRESSURE_THRESHOLD);

    let payload = PollResultPayload {
        review_requests: reviews_items,
        in_flight: mine.items,
        standalone_runs,
        recently_resolved,
        rate_limit,
        polled_at: now_iso(),
        auto_requeue_errors: mine.auto_requeue_errors,
    };
    let _ = app.emit(EVENT_POLL_RESULT, payload);
    Ok(rate_limited)
}

/// Build an ActionableItem for a PR we only know from `pr_lifecycle_history`,
/// using the snapshot captured at the moment of transition. Snapshot fields
/// may be `None` for legacy rows written before migration v6 — the renderer
/// falls back to an "#N"-style title and an empty author in that case.
fn synthesize_resolved_pr_row(
    pr_id: &str,
    lifecycle: crate::poller::types::PrLifecycle,
    resolved_at: &str,
    snapshot: &PrSnapshot,
) -> Option<ActionableItem> {
    use crate::poller::types::{ActionableItemPr, ActionableKind};
    // pr_id format: `pr:{owner}/{repo}#{num}`
    let rest = pr_id.strip_prefix("pr:")?;
    let (repo_full_name, num_str) = rest.rsplit_once('#')?;
    let number: i64 = num_str.parse().ok()?;
    let (owner, repo) = repo_full_name.split_once('/')?;
    let url = snapshot
        .url
        .clone()
        .unwrap_or_else(|| format!("https://github.com/{owner}/{repo}/pull/{number}"));
    let title = snapshot
        .title
        .clone()
        .unwrap_or_else(|| format!("#{number}"));
    let author = snapshot.author.clone().unwrap_or_default();
    Some(ActionableItem {
        id: pr_id.to_string(),
        kind: ActionableKind::Pr,
        title,
        url,
        repo_full_name: repo_full_name.to_string(),
        updated_at: resolved_at.to_string(),
        unread: false,
        dismissed_until_fingerprint: None,
        pr: Some(ActionableItemPr {
            number,
            author,
            body: None,
            is_authored_by_me: false,
            is_review_requested_from_me: false,
            is_author_on_my_team: false,
            ive_commented: false,
            ive_reviewed: false,
            ive_approved: false,
            approval_count: 0,
            is_draft: false,
            additions: 0,
            deletions: 0,
            created_at: resolved_at.to_string(),
            lifecycle,
            merge_queue: None,
            task_urls: Vec::new(),
            score: 0,
            reviewers: None,
            check_runs: None,
            associated_runs: None,
        }),
        run: None,
    })
}

/// Map a poll-cycle error into a UI-facing message + the structured signals
/// downstream consumers (and Phase 5's adaptive interval) need.
fn describe_error(err: &BeetError) -> (String, bool, Option<u64>) {
    match err {
        BeetError::RateLimited { retry_after_secs } => {
            let message = match retry_after_secs {
                Some(n) => format!("GitHub rate limit hit. Retry in {n}s."),
                None => "GitHub rate limit hit.".to_string(),
            };
            (message, true, *retry_after_secs)
        }
        BeetError::Unauthorized(_) => (
            "GitHub rejected the PAT. Re-enter it in Settings.".to_string(),
            false,
            None,
        ),
        other => (other.to_string(), false, None),
    }
}

/// The poller needs the authenticated login to build search queries. Token
/// *validation* (scopes, etc.) stays in the JS auth flow.
async fn fetch_username(client: &GithubClient, db: &Db) -> BeetResult<String> {
    let url = client.url("/user");
    let res = client
        .beet_get::<AuthUser>(db, "user:authenticated", &url)
        .await?;
    Ok(res.body.login)
}

/// Build the `poll:result` payload from the static mock fixture and emit it,
/// followed by an `ok` status. Used only when `BEET_MOCK=1` (demo / offline).
fn emit_mock<R: Runtime>(app: &AppHandle<R>) {
    let lists = crate::mock::mock_payload();
    let payload = PollResultPayload {
        review_requests: lists.review_requests,
        in_flight: lists.in_flight,
        standalone_runs: lists.standalone_runs,
        recently_resolved: lists.recently_resolved,
        rate_limit: lists.rate_limit,
        polled_at: now_iso(),
        auto_requeue_errors: Vec::new(),
    };
    let _ = app.emit(EVENT_POLL_RESULT, payload);
    emit_status(app, "ok", None, false, None);
}

fn emit_status<R: Runtime>(
    app: &AppHandle<R>,
    state: &'static str,
    error: Option<String>,
    rate_limited: bool,
    retry_after_secs: Option<u64>,
) {
    let _ = app.emit(
        EVENT_POLL_STATUS,
        PollStatusPayload {
            state,
            error,
            rate_limited,
            retry_after_secs,
        },
    );
}
