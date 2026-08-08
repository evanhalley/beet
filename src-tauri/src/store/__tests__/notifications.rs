
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
