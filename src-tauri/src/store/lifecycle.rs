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

/// Insert a lifecycle row only when the state actually changed.
pub fn record_lifecycle(
    conn: &Connection,
    pr_id: &str,
    lifecycle: PrLifecycle,
) -> rusqlite::Result<()> {
    if get_latest_lifecycle(conn, pr_id)? == Some(lifecycle) {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO pr_lifecycle_history (pr_id, lifecycle, observed_at) VALUES (?1, ?2, ?3)",
        (pr_id, lifecycle.as_db_str(), now_iso()),
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

/// PR ids whose latest recorded lifecycle is `merged` or `closed`, observed
/// since `since_iso`. Powers the PR half of Recently Resolved (#6).
pub fn list_recently_resolved_pr_ids(
    conn: &Connection,
    since_iso: &str,
) -> rusqlite::Result<Vec<(String, PrLifecycle, String)>> {
    let mut stmt = conn.prepare(
        "SELECT pr_id, lifecycle, MAX(observed_at) AS resolved_at
         FROM pr_lifecycle_history
         WHERE lifecycle IN ('merged', 'closed') AND observed_at >= ?1
         GROUP BY pr_id
         ORDER BY resolved_at DESC",
    )?;
    let rows = stmt.query_map([since_iso], |r| {
        let pr_id: String = r.get(0)?;
        let lifecycle: String = r.get(1)?;
        let observed_at: String = r.get(2)?;
        Ok((pr_id, lifecycle, observed_at))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (pr_id, lifecycle, observed_at) = row?;
        if let Some(lc) = PrLifecycle::from_db_str(&lifecycle) {
            out.push((pr_id, lc, observed_at));
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
mod tests {
    use super::*;
    use crate::store::db::open_in_memory;

    #[test]
    fn record_lifecycle_only_inserts_on_transition() {
        let conn = open_in_memory().unwrap();
        // `observed_at` (millisecond precision) is part of the PK; real
        // transitions are minutes apart, so space the test inserts out.
        record_lifecycle(&conn, "pr:foo/bar#1", PrLifecycle::Open).unwrap();
        record_lifecycle(&conn, "pr:foo/bar#1", PrLifecycle::Open).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        record_lifecycle(&conn, "pr:foo/bar#1", PrLifecycle::InReview).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM pr_lifecycle_history WHERE pr_id = 'pr:foo/bar#1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
        assert_eq!(
            get_latest_lifecycle(&conn, "pr:foo/bar#1").unwrap(),
            Some(PrLifecycle::InReview)
        );
    }

    #[test]
    fn detect_ejection_fires_only_on_queue_exit_not_into_merged() {
        let conn = open_in_memory().unwrap();
        let pr = "pr:foo/bar#2";
        record_lifecycle(&conn, pr, PrLifecycle::MergeQueue).unwrap();
        assert!(detect_ejection(&conn, pr, PrLifecycle::Open).unwrap());
        assert!(detect_ejection(&conn, pr, PrLifecycle::InReview).unwrap());
        assert!(!detect_ejection(&conn, pr, PrLifecycle::Merged).unwrap());
        assert!(!detect_ejection(&conn, pr, PrLifecycle::MergeQueue).unwrap());
    }

    #[test]
    fn detect_ejection_false_when_not_previously_in_queue() {
        let conn = open_in_memory().unwrap();
        let pr = "pr:foo/bar#3";
        record_lifecycle(&conn, pr, PrLifecycle::Open).unwrap();
        assert!(!detect_ejection(&conn, pr, PrLifecycle::Closed).unwrap());
    }

    #[test]
    fn ejection_event_round_trips() {
        let conn = open_in_memory().unwrap();
        let pr = "pr:foo/bar#4";
        let checks = vec![EjectedCheck {
            name: "ci/test".to_string(),
            conclusion: "failure".to_string(),
            details_url: Some("https://example.com".to_string()),
        }];
        record_ejection_event(&conn, pr, "abc123", &checks).unwrap();
        let event = get_latest_ejection_event(&conn, pr).unwrap().unwrap();
        assert_eq!(event.head_sha, "abc123");
        assert_eq!(event.failing_checks, checks);
    }

    #[test]
    fn get_latest_ejection_event_none_when_absent() {
        let conn = open_in_memory().unwrap();
        assert_eq!(get_latest_ejection_event(&conn, "nope").unwrap(), None);
    }

    #[test]
    fn list_recently_resolved_excludes_open_and_old_rows() {
        let conn = open_in_memory().unwrap();
        // pr 1: closed today -> included
        conn.execute(
            "INSERT INTO pr_lifecycle_history (pr_id, lifecycle, observed_at)
             VALUES ('pr:foo/bar#1', 'merged', '2026-05-18T12:00:00.000Z')",
            [],
        )
        .unwrap();
        // pr 2: open today -> excluded (not merged/closed)
        conn.execute(
            "INSERT INTO pr_lifecycle_history (pr_id, lifecycle, observed_at)
             VALUES ('pr:foo/bar#2', 'open', '2026-05-18T12:00:00.000Z')",
            [],
        )
        .unwrap();
        // pr 3: merged a week ago -> excluded by since filter
        conn.execute(
            "INSERT INTO pr_lifecycle_history (pr_id, lifecycle, observed_at)
             VALUES ('pr:foo/bar#3', 'merged', '2026-05-10T12:00:00.000Z')",
            [],
        )
        .unwrap();
        let rows =
            list_recently_resolved_pr_ids(&conn, "2026-05-17T00:00:00.000Z").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, "pr:foo/bar#1");
        assert_eq!(rows[0].1, PrLifecycle::Merged);
    }
}
