
use super::*;

#[test]
fn migrate_creates_all_tables_and_sets_version() {
    let conn = open_in_memory().unwrap();
    let version: i64 = conn
        .query_row("SELECT user_version FROM pragma_user_version", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(version, 11);
    for table in [
        "etag_cache",
        "pr_lifecycle_history",
        "pr_ejection_events",
        "pr_requeue_attempts",
        "run_completion_events",
        "notifications_sent",
        "mute_rules",
        "pin_rules",
        "notification_links",
        "suppress_rules",
        "snooze_rules",
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
        .query_row("SELECT user_version FROM pragma_user_version", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(version, 11);
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
        .query_row("SELECT user_version FROM pragma_user_version", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(version, 11);
    // Pre-existing row survives.
    let rows: i64 = conn
        .query_row("SELECT count(*) FROM etag_cache", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 1);
}
