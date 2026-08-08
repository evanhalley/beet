
use super::*;
use crate::store::db::open_in_memory;

#[test]
fn get_returns_none_when_absent() {
    let conn = open_in_memory().unwrap();
    assert_eq!(get_cached(&conn, "missing").unwrap(), None);
}

#[test]
fn set_then_get_round_trips() {
    let conn = open_in_memory().unwrap();
    set_cached(&conn, "k", "etag-1", "{\"a\":1}").unwrap();
    let entry = get_cached(&conn, "k").unwrap().unwrap();
    assert_eq!(entry.etag, "etag-1");
    assert_eq!(entry.body_json, "{\"a\":1}");
    assert!(!entry.fetched_at.is_empty());
}

#[test]
fn set_upserts_on_conflict() {
    let conn = open_in_memory().unwrap();
    set_cached(&conn, "k", "etag-1", "{\"a\":1}").unwrap();
    set_cached(&conn, "k", "etag-2", "{\"a\":2}").unwrap();
    let entry = get_cached(&conn, "k").unwrap().unwrap();
    assert_eq!(entry.etag, "etag-2");
    assert_eq!(entry.body_json, "{\"a\":2}");
    let count: i64 = conn
        .query_row("SELECT count(*) FROM etag_cache", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn clear_removes_all_rows() {
    let conn = open_in_memory().unwrap();
    set_cached(&conn, "a", "e", "{}").unwrap();
    set_cached(&conn, "b", "e", "{}").unwrap();
    clear_cache(&conn).unwrap();
    let count: i64 = conn
        .query_row("SELECT count(*) FROM etag_cache", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
}
