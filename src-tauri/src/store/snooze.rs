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
#[path = "__tests__/snooze.rs"]
mod tests;
