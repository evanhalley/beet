//! Persistence for completed workflow runs (#6). The `run_completion_events`
//! table powers two things:
//!
//! - The run half of the Recently Resolved section, so it survives restarts
//!   instead of resetting whenever the in-memory poll state is lost.
//! - Phase 9's "run finished" notification, dedupe key `run:{id}:{conclusion}`.

use rusqlite::Connection;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunCompletionEvent {
    pub run_id: i64,
    pub repo: String,
    pub workflow_name: String,
    pub conclusion: Option<String>,
    pub concluded_at: String,
    pub pr_number: Option<i64>,
    /// Snapshot fields (migration v6) — let Recently Resolved render the run
    /// row faithfully after the run is no longer in the live poll set.
    /// `None` for rows written before the migration; renderers fall back.
    pub event: Option<String>,
    pub sha: Option<String>,
    pub run_number: Option<i64>,
    pub actor_login: Option<String>,
    pub run_url: Option<String>,
    pub branch: Option<String>,
}

/// Upsert one completion event. INSERT-OR-IGNORE means we only store the
/// first time we see a `(run_id)` resolve — subsequent polls observing the
/// same terminal state are no-ops, which is what #9 wants for dedupe.
pub fn record_completion(conn: &Connection, event: &RunCompletionEvent) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO run_completion_events
         (run_id, repo, workflow_name, conclusion, concluded_at, pr_number,
          event, sha, run_number, actor_login, run_url, branch)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        (
            event.run_id,
            &event.repo,
            &event.workflow_name,
            event.conclusion.as_deref(),
            &event.concluded_at,
            event.pr_number,
            event.event.as_deref(),
            event.sha.as_deref(),
            event.run_number,
            event.actor_login.as_deref(),
            event.run_url.as_deref(),
            event.branch.as_deref(),
        ),
    )?;
    Ok(())
}

/// Completion events newer than `since_iso`, most-recent first. Powers the
/// run half of the Recently Resolved section.
pub fn list_recent_completions(
    conn: &Connection,
    since_iso: &str,
) -> rusqlite::Result<Vec<RunCompletionEvent>> {
    let mut stmt = conn.prepare(
        "SELECT run_id, repo, workflow_name, conclusion, concluded_at, pr_number,
                event, sha, run_number, actor_login, run_url, branch
         FROM run_completion_events
         WHERE concluded_at >= ?1
         ORDER BY concluded_at DESC",
    )?;
    let rows = stmt.query_map([since_iso], |r| {
        Ok(RunCompletionEvent {
            run_id: r.get(0)?,
            repo: r.get(1)?,
            workflow_name: r.get(2)?,
            conclusion: r.get(3)?,
            concluded_at: r.get(4)?,
            pr_number: r.get(5)?,
            event: r.get(6)?,
            sha: r.get(7)?,
            run_number: r.get(8)?,
            actor_login: r.get(9)?,
            run_url: r.get(10)?,
            branch: r.get(11)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Delete completion rows older than `before_iso`. Recently Resolved only
/// looks back 24 h, so anything older is unreferenced; sweeping it keeps the
/// table bounded across months of polling.
pub fn prune_completions_older_than(
    conn: &Connection,
    before_iso: &str,
) -> rusqlite::Result<usize> {
    let n = conn.execute(
        "DELETE FROM run_completion_events WHERE concluded_at < ?1",
        [before_iso],
    )?;
    Ok(n)
}

#[cfg(test)]
#[path = "__tests__/runs.rs"]
mod tests;
