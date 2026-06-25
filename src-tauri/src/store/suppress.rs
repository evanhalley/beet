//! Per-PR suppression DAL + Tauri commands.
//!
//! A suppressed PR (keyed by its stable `ActionableItem` id, e.g.
//! `pr:owner/repo#42`) is hidden from the Review Requests list unless "Show all"
//! is on — a finer-grained noise control than a repo/org mute. Like mutes, the
//! filter is applied at the frontend visibility layer (`isReviewRequestVisible`)
//! so the Rust poller cache stays complete and un-suppressing never refetches.

use crate::store::{db::now_iso, Db};
use rusqlite::params;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn list_suppressions(db: State<'_, Arc<Db>>) -> Result<Vec<String>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT item_id FROM suppress_rules ORDER BY created_at")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn add_suppression(db: State<'_, Arc<Db>>, item_id: String) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO suppress_rules (item_id, created_at) VALUES (?1, ?2)",
        params![item_id, now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn remove_suppression(db: State<'_, Arc<Db>>, item_id: String) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM suppress_rules WHERE item_id = ?1",
        params![item_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::store::db::open_in_memory;

    #[test]
    fn suppress_crud_round_trip() {
        let conn = open_in_memory().unwrap();
        let db = std::sync::Mutex::new(conn);

        // Add a suppression.
        {
            let c = db.lock().unwrap();
            c.execute(
                "INSERT OR IGNORE INTO suppress_rules (item_id, created_at) VALUES ('pr:owner/foo#42', '2024-01-01T00:00:00.000Z')",
                [],
            )
            .unwrap();
        }

        // List returns it.
        let ids: Vec<String> = {
            let c = db.lock().unwrap();
            let mut stmt = c.prepare("SELECT item_id FROM suppress_rules").unwrap();
            stmt.query_map([], |row| row.get::<_, String>(0))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        assert_eq!(ids, vec!["pr:owner/foo#42".to_string()]);

        // INSERT OR IGNORE is idempotent — re-adding doesn't duplicate.
        {
            let c = db.lock().unwrap();
            c.execute(
                "INSERT OR IGNORE INTO suppress_rules (item_id, created_at) VALUES ('pr:owner/foo#42', '2024-02-01T00:00:00.000Z')",
                [],
            )
            .unwrap();
            let count: i64 = c
                .query_row("SELECT count(*) FROM suppress_rules", [], |r| r.get(0))
                .unwrap();
            assert_eq!(count, 1);
        }

        // Remove it.
        {
            let c = db.lock().unwrap();
            c.execute(
                "DELETE FROM suppress_rules WHERE item_id='pr:owner/foo#42'",
                [],
            )
            .unwrap();
        }
        let count: i64 = {
            let c = db.lock().unwrap();
            c.query_row("SELECT count(*) FROM suppress_rules", [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(count, 0);
    }
}
