//! Notification dedupe DAL + Tauri command (§9 / §10).
//!
//! Before firing an OS notification the frontend calls
//! `check_and_record_notification` with its dedupe key. This command does an
//! atomic INSERT OR IGNORE and returns `true` only when the key was new — the
//! caller skips `sendNotification` when it gets `false`.
//!
//! Write-before-notify order: if the OS call subsequently fails we lose one
//! notification, which is preferable to the reverse (write-after-notify) where
//! a crash between the notify and the write fires the same notification twice.

use crate::store::{db::now_iso, Db};
use rusqlite::{params, OptionalExtension};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn check_and_record_notification(
    db: State<'_, Arc<Db>>,
    dedupe_key: String,
) -> Result<bool, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO notifications_sent (dedupe_key, fired_at) VALUES (?1, ?2)",
        params![dedupe_key, now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.changes() > 0)
}

/// Persist the mapping from an OS notification's numeric `id` to the
/// ActionableItem it points at. INSERT OR REPLACE so a re-fired notification
/// (same id, derived from a stable dedupe key) updates the target in place.
#[tauri::command]
pub fn record_notification_link(
    db: State<'_, Arc<Db>>,
    notif_id: i64,
    item_id: String,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO notification_links (notif_id, item_id, created_at) VALUES (?1, ?2, ?3)",
        params![notif_id, item_id, now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Resolve the ActionableItem id a notification points at. Returns `None` when
/// the id is unknown (e.g. a notification from a previous schema or evicted row).
#[tauri::command]
pub fn get_notification_link(
    db: State<'_, Arc<Db>>,
    notif_id: i64,
) -> Result<Option<String>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT item_id FROM notification_links WHERE notif_id = ?1",
        params![notif_id],
        |r| r.get::<_, String>(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::db::open_in_memory;

    #[test]
    fn notification_link_round_trips_and_missing_is_none() {
        let conn = open_in_memory().unwrap();

        // Unknown id → None.
        let found: Option<String> = conn
            .query_row(
                "SELECT item_id FROM notification_links WHERE notif_id = 42",
                [],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert_eq!(found, None);

        // Record then read back.
        conn.execute(
            "INSERT OR REPLACE INTO notification_links (notif_id, item_id, created_at) VALUES (42, 'pr:owner/repo#7', 'now')",
            [],
        )
        .unwrap();
        let found: Option<String> = conn
            .query_row(
                "SELECT item_id FROM notification_links WHERE notif_id = 42",
                [],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert_eq!(found.as_deref(), Some("pr:owner/repo#7"));

        // Same id, new target → replaced in place.
        conn.execute(
            "INSERT OR REPLACE INTO notification_links (notif_id, item_id, created_at) VALUES (42, 'pr:owner/repo#9', 'now')",
            [],
        )
        .unwrap();
        let found: Option<String> = conn
            .query_row(
                "SELECT item_id FROM notification_links WHERE notif_id = 42",
                [],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert_eq!(found.as_deref(), Some("pr:owner/repo#9"));
    }

    #[test]
    fn first_key_returns_true_second_returns_false() {
        let conn = open_in_memory().unwrap();

        // First time: INSERT succeeds → changes() == 1 → true.
        conn.execute(
            "INSERT OR IGNORE INTO notifications_sent (dedupe_key, fired_at) VALUES ('key1', 'now')",
            [],
        )
        .unwrap();
        assert_eq!(conn.changes(), 1);

        // Second time with same key: INSERT is ignored → changes() == 0 → false.
        conn.execute(
            "INSERT OR IGNORE INTO notifications_sent (dedupe_key, fired_at) VALUES ('key1', 'now')",
            [],
        )
        .unwrap();
        assert_eq!(conn.changes(), 0);

        // Different key: INSERT succeeds again.
        conn.execute(
            "INSERT OR IGNORE INTO notifications_sent (dedupe_key, fired_at) VALUES ('key2', 'now')",
            [],
        )
        .unwrap();
        assert_eq!(conn.changes(), 1);
    }
}
