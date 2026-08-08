//! Per-item snooze DAL + Tauri commands.
//!
//! A snoozed item (keyed by its stable `ActionableItem` id, e.g.
//! `pr:owner/repo#42`) is hidden from the live sections until its
//! `snoozed_until` timestamp passes. Like suppressions, the filter is applied
//! at the frontend visibility layer so the Rust poller cache stays complete
//! and un-snoozing never refetches. Expired rows are purged lazily on list.

use crate::store::{db::now_iso, Db};
use rusqlite::{params, Connection};
use std::sync::Arc;
use tauri::State;

#[derive(serde::Serialize)]
pub struct SnoozeRule {
    pub item_id: String,
    pub snoozed_until: String,
}

/// Delete rows whose snooze has expired. ISO-8601 UTC strings (now_iso
/// format) compare lexically, so a string comparison is a time comparison.
fn purge_expired(conn: &Connection, now: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM snooze_rules WHERE snoozed_until <= ?1",
        params![now],
    )
}

fn list(conn: &Connection) -> rusqlite::Result<Vec<SnoozeRule>> {
    let mut stmt =
        conn.prepare("SELECT item_id, snoozed_until FROM snooze_rules ORDER BY created_at")?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SnoozeRule {
                item_id: row.get(0)?,
                snoozed_until: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn add(conn: &Connection, item_id: &str, snoozed_until: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO snooze_rules (item_id, snoozed_until, created_at) VALUES (?1, ?2, ?3)",
        params![item_id, snoozed_until, now_iso()],
    )?;
    Ok(())
}

fn remove(conn: &Connection, item_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM snooze_rules WHERE item_id = ?1",
        params![item_id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn list_snoozes(db: State<'_, Arc<Db>>) -> Result<Vec<SnoozeRule>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    purge_expired(&conn, &now_iso()).map_err(|e| e.to_string())?;
    list(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_snooze(
    db: State<'_, Arc<Db>>,
    item_id: String,
    snoozed_until: String,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    add(&conn, &item_id, &snoozed_until).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_snooze(db: State<'_, Arc<Db>>, item_id: String) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    remove(&conn, &item_id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::db::open_in_memory;

    #[test]
    fn snooze_crud_round_trip() {
        let conn = open_in_memory().unwrap();

        add(&conn, "pr:owner/foo#42", "2099-01-01T00:00:00.000Z").unwrap();

        let rules = list(&conn).unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].item_id, "pr:owner/foo#42");
        assert_eq!(rules[0].snoozed_until, "2099-01-01T00:00:00.000Z");

        remove(&conn, "pr:owner/foo#42").unwrap();
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn re_snoozing_replaces_the_until_timestamp() {
        let conn = open_in_memory().unwrap();

        add(&conn, "pr:owner/foo#42", "2099-01-01T00:00:00.000Z").unwrap();
        add(&conn, "pr:owner/foo#42", "2099-06-01T00:00:00.000Z").unwrap();

        let rules = list(&conn).unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].snoozed_until, "2099-06-01T00:00:00.000Z");
    }

    #[test]
    fn purge_removes_expired_rows_and_keeps_active_ones() {
        let conn = open_in_memory().unwrap();

        add(&conn, "pr:owner/expired#1", "2024-01-01T00:00:00.000Z").unwrap();
        add(&conn, "pr:owner/active#2", "2099-01-01T00:00:00.000Z").unwrap();

        let purged = purge_expired(&conn, "2025-01-01T00:00:00.000Z").unwrap();
        assert_eq!(purged, 1);

        let rules = list(&conn).unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].item_id, "pr:owner/active#2");
    }
}
