
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
