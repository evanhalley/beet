//! PR lifecycle + ejection state machine. Port of `src/lib/storage/lifecycle.ts`.
//!
//! `record_lifecycle` only inserts on a *transition*, so the latest
//! `pr_lifecycle_history` row's `observed_at` is the moment the PR entered its
//! current state — relied on for merge-queue "entered at" timestamps.

use crate::error::BeetResult;
use crate::poller::types::{EjectedCheck, PrLifecycle};
use crate::store::db::now_iso;
use rusqlite::{Connection, OptionalExtension};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LifecycleObservation {
    pub lifecycle: PrLifecycle,
    pub observed_at: String,
}

/// Snapshot of the bits of a PR we need to render its Recently Resolved row
/// after the PR is no longer in the live poll set. Captured at the moment a
/// lifecycle transition is recorded; nullable end-to-end so legacy rows
/// from before migration v6 still upgrade in place.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PrSnapshot {
    pub title: Option<String>,
    pub author: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EjectionEvent {
    pub observed_at: String,
    pub head_sha: String,
    pub failing_checks: Vec<EjectedCheck>,
}

/// The most-recent lifecycle observation for a PR, or `None` if never recorded.
pub fn get_latest_lifecycle_row(
    conn: &Connection,
    pr_id: &str,
) -> rusqlite::Result<Option<LifecycleObservation>> {
    let row = conn
        .query_row(
            "SELECT lifecycle, observed_at FROM pr_lifecycle_history
             WHERE pr_id = ?1 ORDER BY observed_at DESC LIMIT 1",
            [pr_id],
            |r| {
                let lifecycle: String = r.get(0)?;
                let observed_at: String = r.get(1)?;
                Ok((lifecycle, observed_at))
            },
        )
        .optional()?;
    Ok(row.and_then(|(lifecycle, observed_at)| {
        PrLifecycle::from_db_str(&lifecycle).map(|lifecycle| LifecycleObservation {
            lifecycle,
            observed_at,
        })
    }))
}

pub fn get_latest_lifecycle(
    conn: &Connection,
    pr_id: &str,
) -> rusqlite::Result<Option<PrLifecycle>> {
    Ok(get_latest_lifecycle_row(conn, pr_id)?.map(|row| row.lifecycle))
}

/// Insert a lifecycle row only when the state actually changed. `snapshot`
/// captures the bits we need to render the Recently Resolved row long after
/// the PR has rotated out of the live poll set; pass `&PrSnapshot::default()`
/// when those fields aren't available at the call site.
pub fn record_lifecycle(
    conn: &Connection,
    pr_id: &str,
    lifecycle: PrLifecycle,
    snapshot: &PrSnapshot,
) -> rusqlite::Result<()> {
    if get_latest_lifecycle(conn, pr_id)? == Some(lifecycle) {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO pr_lifecycle_history
            (pr_id, lifecycle, observed_at, title, author, url)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (
            pr_id,
            lifecycle.as_db_str(),
            now_iso(),
            snapshot.title.as_deref(),
            snapshot.author.as_deref(),
            snapshot.url.as_deref(),
        ),
    )?;
    Ok(())
}

/// A transition *out of* `merge_queue` that is not into `merged` — i.e. the PR
/// was kicked from the queue.
pub fn detect_ejection(
    conn: &Connection,
    pr_id: &str,
    next: PrLifecycle,
) -> rusqlite::Result<bool> {
    let prev = get_latest_lifecycle(conn, pr_id)?;
    Ok(prev == Some(PrLifecycle::MergeQueue)
        && next != PrLifecycle::MergeQueue
        && next != PrLifecycle::Merged)
}

pub fn record_ejection_event(
    conn: &Connection,
    pr_id: &str,
    head_sha: &str,
    failing_checks: &[EjectedCheck],
) -> BeetResult<()> {
    let failing_checks_json = serde_json::to_string(failing_checks)?;
    conn.execute(
        "INSERT INTO pr_ejection_events (pr_id, observed_at, head_sha, failing_checks_json)
         VALUES (?1, ?2, ?3, ?4)",
        (pr_id, now_iso(), head_sha, failing_checks_json),
    )?;
    Ok(())
}

/// One row returned by `list_recently_resolved_pr_ids`: a resolved PR plus
/// the snapshot captured at the moment it transitioned, so the PR half of
/// Recently Resolved renders meaningfully even after the PR has dropped out
/// of the live poll set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedPrRow {
    pub pr_id: String,
    pub lifecycle: PrLifecycle,
    pub resolved_at: String,
    pub snapshot: PrSnapshot,
}

/// PRs whose **latest** recorded lifecycle is `merged` or `closed`, with that
/// terminal observation falling inside `since_iso`. Critically: a PR that
/// merged a week ago and was then reopened today must NOT surface here — the
/// inner subquery picks the actual latest lifecycle (regardless of state),
/// and the outer filter then requires that latest row to be terminal.
pub fn list_recently_resolved_pr_ids(
    conn: &Connection,
    since_iso: &str,
) -> rusqlite::Result<Vec<ResolvedPrRow>> {
    let mut stmt = conn.prepare(
        "SELECT h.pr_id, h.lifecycle, h.observed_at, h.title, h.author, h.url
         FROM pr_lifecycle_history h
         JOIN (
           SELECT pr_id, MAX(observed_at) AS latest_at
           FROM pr_lifecycle_history
           GROUP BY pr_id
         ) m ON m.pr_id = h.pr_id AND m.latest_at = h.observed_at
         WHERE h.lifecycle IN ('merged', 'closed')
           AND h.observed_at >= ?1
         ORDER BY h.observed_at DESC",
    )?;
    let rows = stmt.query_map([since_iso], |r| {
        let pr_id: String = r.get(0)?;
        let lifecycle: String = r.get(1)?;
        let observed_at: String = r.get(2)?;
        let title: Option<String> = r.get(3)?;
        let author: Option<String> = r.get(4)?;
        let url: Option<String> = r.get(5)?;
        Ok((pr_id, lifecycle, observed_at, title, author, url))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (pr_id, lifecycle, observed_at, title, author, url) = row?;
        if let Some(lc) = PrLifecycle::from_db_str(&lifecycle) {
            out.push(ResolvedPrRow {
                pr_id,
                lifecycle: lc,
                resolved_at: observed_at,
                snapshot: PrSnapshot { title, author, url },
            });
        }
    }
    Ok(out)
}

pub fn get_latest_ejection_event(
    conn: &Connection,
    pr_id: &str,
) -> BeetResult<Option<EjectionEvent>> {
    let row = conn
        .query_row(
            "SELECT observed_at, head_sha, failing_checks_json FROM pr_ejection_events
             WHERE pr_id = ?1 ORDER BY observed_at DESC LIMIT 1",
            [pr_id],
            |r| {
                let observed_at: String = r.get(0)?;
                let head_sha: String = r.get(1)?;
                let failing_checks_json: String = r.get(2)?;
                Ok((observed_at, head_sha, failing_checks_json))
            },
        )
        .optional()?;
    match row {
        None => Ok(None),
        Some((observed_at, head_sha, failing_checks_json)) => {
            let failing_checks: Vec<EjectedCheck> = serde_json::from_str(&failing_checks_json)?;
            Ok(Some(EjectionEvent {
                observed_at,
                head_sha,
                failing_checks,
            }))
        }
    }
}

#[cfg(test)]
#[path = "__tests__/lifecycle.rs"]
mod tests;
