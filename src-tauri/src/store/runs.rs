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
}

/// Upsert one completion event. INSERT-OR-IGNORE means we only store the
/// first time we see a `(run_id)` resolve — subsequent polls observing the
/// same terminal state are no-ops, which is what #9 wants for dedupe.
pub fn record_completion(
    conn: &Connection,
    event: &RunCompletionEvent,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO run_completion_events
         (run_id, repo, workflow_name, conclusion, concluded_at, pr_number)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (
            event.run_id,
            &event.repo,
            &event.workflow_name,
            event.conclusion.as_deref(),
            &event.concluded_at,
            event.pr_number,
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
        "SELECT run_id, repo, workflow_name, conclusion, concluded_at, pr_number
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
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::db::open_in_memory;

    fn ev(id: i64, concluded_at: &str) -> RunCompletionEvent {
        RunCompletionEvent {
            run_id: id,
            repo: "foo/bar".into(),
            workflow_name: "CI".into(),
            conclusion: Some("success".into()),
            concluded_at: concluded_at.into(),
            pr_number: None,
        }
    }

    #[test]
    fn record_then_list_round_trips() {
        let conn = open_in_memory().unwrap();
        record_completion(&conn, &ev(1, "2026-01-02T00:00:00.000Z")).unwrap();
        record_completion(&conn, &ev(2, "2026-01-03T00:00:00.000Z")).unwrap();
        let rows = list_recent_completions(&conn, "2026-01-01T00:00:00.000Z").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].run_id, 2); // newest first
        assert_eq!(rows[1].run_id, 1);
    }

    #[test]
    fn since_filter_excludes_older_rows() {
        let conn = open_in_memory().unwrap();
        record_completion(&conn, &ev(1, "2025-12-31T00:00:00.000Z")).unwrap();
        record_completion(&conn, &ev(2, "2026-01-02T00:00:00.000Z")).unwrap();
        let rows = list_recent_completions(&conn, "2026-01-01T00:00:00.000Z").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].run_id, 2);
    }

    #[test]
    fn insert_or_ignore_dedupes_on_run_id() {
        let conn = open_in_memory().unwrap();
        record_completion(&conn, &ev(1, "2026-01-02T00:00:00.000Z")).unwrap();
        // Second observation of the same run with a different conclusion does
        // *not* overwrite — we only ever record the first terminal state.
        let mut second = ev(1, "2026-01-03T00:00:00.000Z");
        second.conclusion = Some("failure".into());
        record_completion(&conn, &second).unwrap();
        let rows = list_recent_completions(&conn, "2026-01-01T00:00:00.000Z").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].conclusion.as_deref(), Some("success"));
    }
}
