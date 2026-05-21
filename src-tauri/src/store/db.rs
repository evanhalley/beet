//! Rusqlite connection wrapper. Owns `beet.db` (the same file tauri-plugin-sql
//! used) and runs the `user_version`-based migration stepper.

use chrono::SecondsFormat;
use rusqlite::Connection;
use std::path::Path;

/// Migration SQL, indexed by `version - 1`. Append-only — never edit a past
/// entry. Kept byte-compatible with the historical tauri-plugin-sql migrations
/// so an existing `beet.db` upgrades in place (`CREATE TABLE IF NOT EXISTS`).
const MIGRATIONS: &[&str] = &[
    // v1: create etag_cache table
    "CREATE TABLE IF NOT EXISTS etag_cache (
        cache_key  TEXT PRIMARY KEY,
        etag       TEXT NOT NULL,
        body_json  TEXT NOT NULL,
        fetched_at TEXT NOT NULL
    );",
    // v2: create pr_lifecycle_history table
    "CREATE TABLE IF NOT EXISTS pr_lifecycle_history (
        pr_id       TEXT NOT NULL,
        lifecycle   TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        PRIMARY KEY (pr_id, observed_at)
    );",
    // v3: create pr_ejection_events table
    "CREATE TABLE IF NOT EXISTS pr_ejection_events (
        pr_id               TEXT NOT NULL,
        observed_at         TEXT NOT NULL,
        head_sha            TEXT NOT NULL,
        failing_checks_json TEXT NOT NULL,
        PRIMARY KEY (pr_id, observed_at)
    );",
    // v4: create pr_requeue_attempts table. Records each auto-requeue attempt
    // per (pr_id, head_sha) so the cap survives app restarts. The same table
    // doubles as the per-PR opt-out store: a sentinel row with attempted_at =
    // 'opt-out' carries opt_out = 1 and is excluded from cap counting.
    "CREATE TABLE IF NOT EXISTS pr_requeue_attempts (
        pr_id        TEXT NOT NULL,
        head_sha     TEXT NOT NULL,
        attempted_at TEXT NOT NULL,
        succeeded    INTEGER NOT NULL,
        opt_out      INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (pr_id, head_sha, attempted_at)
    );",
    // v5: create run_completion_events table (#6). Records each workflow run
    // we've seen reach a terminal status, so the Recently Resolved section
    // survives restarts and #9's "run finished" notification can dedupe on
    // (run_id, conclusion).
    "CREATE TABLE IF NOT EXISTS run_completion_events (
        run_id         INTEGER PRIMARY KEY,
        repo           TEXT NOT NULL,
        workflow_name  TEXT NOT NULL,
        conclusion     TEXT,
        concluded_at   TEXT NOT NULL,
        pr_number      INTEGER
    );",
    // v6: snapshot the bits of a run / PR we need to faithfully render its
    // Recently Resolved row without going back to the API after the source
    // PR / run is no longer in the live poll set. Nullable so existing rows
    // upgrade in place; renderers fall back when a snapshot is missing.
    "ALTER TABLE pr_lifecycle_history ADD COLUMN title TEXT;
     ALTER TABLE pr_lifecycle_history ADD COLUMN author TEXT;
     ALTER TABLE pr_lifecycle_history ADD COLUMN url TEXT;
     ALTER TABLE run_completion_events ADD COLUMN event TEXT;
     ALTER TABLE run_completion_events ADD COLUMN sha TEXT;
     ALTER TABLE run_completion_events ADD COLUMN run_number INTEGER;
     ALTER TABLE run_completion_events ADD COLUMN actor_login TEXT;
     ALTER TABLE run_completion_events ADD COLUMN run_url TEXT;
     ALTER TABLE run_completion_events ADD COLUMN branch TEXT;",
    // v7: notification dedupe — each fired OS notification records its dedupe
    // key here. `check_and_record_notification` does an atomic INSERT OR IGNORE
    // and returns whether the key was new; callers skip the OS call if not.
    "CREATE TABLE IF NOT EXISTS notifications_sent (
        dedupe_key TEXT PRIMARY KEY,
        fired_at   TEXT NOT NULL
    );",
    // v8: mute and pin rules. Muted repos/orgs are filtered out of every UI
    // section (applied at the Zustand selector layer). Pinned repos force the
    // fast-poll interval (×1 multiplier in the Rust adaptive poller).
    "CREATE TABLE IF NOT EXISTS mute_rules (
        scope      TEXT NOT NULL,
        value      TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (scope, value)
    );
    CREATE TABLE IF NOT EXISTS pin_rules (
        value      TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
    );",
];

/// Open `beet.db` at `path` and bring its schema up to date.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    migrate(&conn)?;
    Ok(conn)
}

/// In-memory connection for tests.
#[cfg(test)]
pub fn open_in_memory() -> rusqlite::Result<Connection> {
    let conn = Connection::open_in_memory()?;
    migrate(&conn)?;
    Ok(conn)
}

/// Step the DB forward to the latest schema version. Existing `beet.db` files
/// created by tauri-plugin-sql have `user_version = 0` but the tables already
/// exist; the `IF NOT EXISTS` statements make re-running them a no-op.
pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i64 =
        conn.query_row("SELECT user_version FROM pragma_user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let target = (i + 1) as i64;
        if version < target {
            conn.execute_batch(sql)?;
            conn.pragma_update(None, "user_version", target)?;
        }
    }
    Ok(())
}

/// Current timestamp, formatted to match JS `new Date().toISOString()`
/// (millisecond precision, `Z` suffix) so Rust- and JS-written rows sort
/// consistently.
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_creates_all_tables_and_sets_version() {
        let conn = open_in_memory().unwrap();
        let version: i64 = conn
            .query_row("SELECT user_version FROM pragma_user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 8);
        for table in [
            "etag_cache",
            "pr_lifecycle_history",
            "pr_ejection_events",
            "pr_requeue_attempts",
            "run_completion_events",
            "notifications_sent",
            "mute_rules",
            "pin_rules",
        ] {
            let count: i64 = conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "table {table} should exist");
        }
    }

    #[test]
    fn migrate_is_idempotent() {
        let conn = open_in_memory().unwrap();
        // Running again must not error or downgrade.
        migrate(&conn).unwrap();
        let version: i64 = conn
            .query_row("SELECT user_version FROM pragma_user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 8);
    }

    #[test]
    fn migrate_upgrades_a_preexisting_pluginsql_db() {
        // Simulate a DB created by tauri-plugin-sql: tables exist, user_version 0.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATIONS[0]).unwrap();
        conn.execute_batch(MIGRATIONS[1]).unwrap();
        conn.execute_batch(MIGRATIONS[2]).unwrap();
        conn.execute(
            "INSERT INTO etag_cache (cache_key, etag, body_json, fetched_at) VALUES ('k','e','{}','t')",
            [],
        )
        .unwrap();

        migrate(&conn).unwrap();

        let version: i64 = conn
            .query_row("SELECT user_version FROM pragma_user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 6);
        // Pre-existing row survives.
        let rows: i64 = conn
            .query_row("SELECT count(*) FROM etag_cache", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1);
    }
}
