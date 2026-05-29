//! Persistence for the auto-requeue worker (issue #13).
//!
//! `pr_requeue_attempts` records each enqueue attempt the worker makes against
//! a `(pr_id, head_sha)`. Counted attempts (succeeded *and* failed) burn the
//! retry cap so a genuinely broken PR stops being retried after a few cycles.
//!
//! The same table doubles as the per-PR opt-out store. A sentinel row with
//! `attempted_at = 'opt-out'` carries `opt_out = 1`; cap-counting filters that
//! sentinel out, and `is_opted_out` looks for it directly. One table, no extra
//! migration.
//!
//! Counts and opt-out reads are cheap and synchronous; callers hold the
//! `store::Db` mutex only across the SQLite call.

use std::sync::Arc;

use rusqlite::{params, Connection};

use crate::store::db::now_iso;
use crate::store::Db;

const OPT_OUT_SENTINEL: &str = "opt-out";

/// Record one auto-requeue attempt. `succeeded = false` still counts toward
/// the cap — a mutation that errors out is just as load-bearing as one that
/// worked, since the goal of the cap is "stop hammering."
pub fn record_attempt(
    conn: &Connection,
    pr_id: &str,
    head_sha: &str,
    succeeded: bool,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO pr_requeue_attempts
            (pr_id, head_sha, attempted_at, succeeded, opt_out)
         VALUES (?1, ?2, ?3, ?4, 0)",
        params![pr_id, head_sha, now_iso(), succeeded as i64],
    )?;
    Ok(())
}

/// Number of real attempts (both succeeded and failed) against this head SHA.
/// The opt-out sentinel row is excluded.
pub fn count_attempts(conn: &Connection, pr_id: &str, head_sha: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM pr_requeue_attempts
         WHERE pr_id = ?1 AND head_sha = ?2 AND opt_out = 0",
        params![pr_id, head_sha],
        |r| r.get(0),
    )
}

/// Set or clear the "don't auto-requeue this PR/head" opt-out. Stored as a
/// single sentinel row keyed by `attempted_at = 'opt-out'`, so toggling it on
/// and off is an UPSERT / DELETE rather than a column toggle.
pub fn set_opt_out(
    conn: &Connection,
    pr_id: &str,
    head_sha: &str,
    opt_out: bool,
) -> rusqlite::Result<()> {
    if opt_out {
        conn.execute(
            "INSERT OR REPLACE INTO pr_requeue_attempts
                (pr_id, head_sha, attempted_at, succeeded, opt_out)
             VALUES (?1, ?2, ?3, 0, 1)",
            params![pr_id, head_sha, OPT_OUT_SENTINEL],
        )?;
    } else {
        conn.execute(
            "DELETE FROM pr_requeue_attempts
             WHERE pr_id = ?1 AND head_sha = ?2 AND attempted_at = ?3",
            params![pr_id, head_sha, OPT_OUT_SENTINEL],
        )?;
    }
    Ok(())
}

pub fn is_opted_out(conn: &Connection, pr_id: &str, head_sha: &str) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pr_requeue_attempts
         WHERE pr_id = ?1 AND head_sha = ?2 AND opt_out = 1",
        params![pr_id, head_sha],
        |r| r.get(0),
    )?;
    Ok(count > 0)
}

/// Backs the DetailPane "Auto-requeued N×" badge (#13). Returns 0 when no
/// attempts have been recorded yet.
#[tauri::command]
pub fn get_requeue_count(
    pr_id: String,
    head_sha: String,
    db: tauri::State<'_, Arc<Db>>,
) -> Result<i64, String> {
    let conn = db.lock().map_err(|e| format!("db lock poisoned: {e}"))?;
    count_attempts(&conn, &pr_id, &head_sha).map_err(|e| e.to_string())
}

/// Backs the DetailPane "Don't auto-requeue this PR" toggle (#13).
#[tauri::command]
pub fn get_requeue_opt_out(
    pr_id: String,
    head_sha: String,
    db: tauri::State<'_, Arc<Db>>,
) -> Result<bool, String> {
    let conn = db.lock().map_err(|e| format!("db lock poisoned: {e}"))?;
    is_opted_out(&conn, &pr_id, &head_sha).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_requeue_opt_out(
    pr_id: String,
    head_sha: String,
    opt_out: bool,
    db: tauri::State<'_, Arc<Db>>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("db lock poisoned: {e}"))?;
    set_opt_out(&conn, &pr_id, &head_sha, opt_out).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::db::open_in_memory;

    #[test]
    fn record_and_count_attempts_round_trips() {
        let conn = open_in_memory().unwrap();
        let pr = "pr:foo/bar#1";
        let sha = "deadbeef";
        assert_eq!(count_attempts(&conn, pr, sha).unwrap(), 0);

        record_attempt(&conn, pr, sha, true).unwrap();
        // attempted_at is part of the PK and uses millisecond precision; in
        // practice attempts are minutes apart but the test fires them back to
        // back, so space them out.
        std::thread::sleep(std::time::Duration::from_millis(2));
        record_attempt(&conn, pr, sha, false).unwrap();
        assert_eq!(count_attempts(&conn, pr, sha).unwrap(), 2);
    }

    #[test]
    fn count_attempts_is_scoped_to_head_sha() {
        // A new push (new head SHA) resets the cap — that's the whole point of
        // keying attempts on (pr_id, head_sha).
        let conn = open_in_memory().unwrap();
        let pr = "pr:foo/bar#1";
        record_attempt(&conn, pr, "sha-old", true).unwrap();
        assert_eq!(count_attempts(&conn, pr, "sha-old").unwrap(), 1);
        assert_eq!(count_attempts(&conn, pr, "sha-new").unwrap(), 0);
    }

    #[test]
    fn opt_out_round_trips_without_burning_the_cap() {
        let conn = open_in_memory().unwrap();
        let pr = "pr:foo/bar#1";
        let sha = "abc";
        assert!(!is_opted_out(&conn, pr, sha).unwrap());

        set_opt_out(&conn, pr, sha, true).unwrap();
        assert!(is_opted_out(&conn, pr, sha).unwrap());
        // Sentinel must not count toward the cap.
        assert_eq!(count_attempts(&conn, pr, sha).unwrap(), 0);

        // Idempotent: setting again is a no-op (INSERT OR REPLACE).
        set_opt_out(&conn, pr, sha, true).unwrap();
        assert!(is_opted_out(&conn, pr, sha).unwrap());

        set_opt_out(&conn, pr, sha, false).unwrap();
        assert!(!is_opted_out(&conn, pr, sha).unwrap());
    }

    #[test]
    fn opt_out_is_scoped_per_pr_and_head_sha() {
        let conn = open_in_memory().unwrap();
        set_opt_out(&conn, "pr:foo/bar#1", "sha-a", true).unwrap();
        assert!(is_opted_out(&conn, "pr:foo/bar#1", "sha-a").unwrap());
        assert!(!is_opted_out(&conn, "pr:foo/bar#1", "sha-b").unwrap());
        assert!(!is_opted_out(&conn, "pr:foo/bar#2", "sha-a").unwrap());
    }
}
