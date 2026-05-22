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
use rusqlite::params;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::db::open_in_memory;

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
