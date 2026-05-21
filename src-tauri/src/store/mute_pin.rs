//! Mute and pin rule DAL + Tauri commands (§8).
//!
//! Muted repos/orgs are filtered out of every UI section at the Zustand
//! selector layer — the Rust poller cache stays complete so unmuting never
//! triggers a refetch. Pinned repos force the fast-poll interval (×1 override
//! in the Rust adaptive poller).

use crate::store::{db::now_iso, Db};
use rusqlite::params;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub struct MuteRule {
    pub scope: String, // "repo" | "org"
    pub value: String, // "owner/repo" or "owner"
}

// ── Mute rules ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_mutes(db: State<'_, Db>) -> Result<Vec<MuteRule>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT scope, value FROM mute_rules ORDER BY created_at")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(MuteRule {
                scope: row.get(0)?,
                value: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn add_mute(db: State<'_, Db>, scope: String, value: String) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO mute_rules (scope, value, created_at) VALUES (?1, ?2, ?3)",
        params![scope, value, now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn remove_mute(db: State<'_, Db>, scope: String, value: String) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM mute_rules WHERE scope = ?1 AND value = ?2",
        params![scope, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Pin rules ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_pins(db: State<'_, Db>) -> Result<Vec<String>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT value FROM pin_rules ORDER BY created_at")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn add_pin(db: State<'_, Db>, value: String) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO pin_rules (value, created_at) VALUES (?1, ?2)",
        params![value, now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn remove_pin(db: State<'_, Db>, value: String) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM pin_rules WHERE value = ?1",
        params![value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Query helpers (used by the poll loop) ───────────────────────────────────

/// Returns true if any pin rules exist — used to decide whether to override
/// the adaptive polling multiplier to ×1.
pub fn has_any_pins(conn: &rusqlite::Connection) -> bool {
    conn.query_row("SELECT count(*) FROM pin_rules", [], |r| r.get::<_, i64>(0))
        .map(|n| n > 0)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::db::open_in_memory;

    #[test]
    fn mute_crud_round_trip() {
        let conn = open_in_memory().unwrap();
        let db = std::sync::Mutex::new(conn);

        // Add a repo mute.
        {
            let c = db.lock().unwrap();
            c.execute(
                "INSERT OR IGNORE INTO mute_rules (scope, value, created_at) VALUES ('repo', 'owner/foo', '2024-01-01T00:00:00.000Z')",
                [],
            ).unwrap();
        }

        // List returns it.
        let rules: Vec<MuteRule> = {
            let c = db.lock().unwrap();
            let mut stmt = c.prepare("SELECT scope, value FROM mute_rules").unwrap();
            stmt.query_map([], |row| {
                Ok(MuteRule { scope: row.get(0)?, value: row.get(1)? })
            })
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
        };
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].scope, "repo");
        assert_eq!(rules[0].value, "owner/foo");

        // Remove it.
        {
            let c = db.lock().unwrap();
            c.execute("DELETE FROM mute_rules WHERE scope='repo' AND value='owner/foo'", []).unwrap();
        }
        let count: i64 = {
            let c = db.lock().unwrap();
            c.query_row("SELECT count(*) FROM mute_rules", [], |r| r.get(0)).unwrap()
        };
        assert_eq!(count, 0);
    }

    #[test]
    fn pin_crud_and_has_any_pins() {
        let conn = open_in_memory().unwrap();
        assert!(!has_any_pins(&conn));

        conn.execute(
            "INSERT OR IGNORE INTO pin_rules (value, created_at) VALUES ('owner/repo', '2024-01-01T00:00:00.000Z')",
            [],
        )
        .unwrap();
        assert!(has_any_pins(&conn));

        conn.execute("DELETE FROM pin_rules WHERE value='owner/repo'", []).unwrap();
        assert!(!has_any_pins(&conn));
    }
}
