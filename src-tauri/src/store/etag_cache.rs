//! ETag cache: `get_cached` / `set_cached` / `clear_cache` over the
//! `etag_cache` table. Port of `src/lib/storage/etag-cache.ts`.
//!
//! Unlike the JS version (which stored the parsed body), the Rust cache stores
//! the raw response text in `body_json`; callers deserialize on read.

use crate::store::db::now_iso;
use rusqlite::{Connection, OptionalExtension};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedEntry {
    pub etag: String,
    pub body_json: String,
    pub fetched_at: String,
}

pub fn get_cached(conn: &Connection, cache_key: &str) -> rusqlite::Result<Option<CachedEntry>> {
    conn.query_row(
        "SELECT etag, body_json, fetched_at FROM etag_cache WHERE cache_key = ?1",
        [cache_key],
        |r| {
            Ok(CachedEntry {
                etag: r.get(0)?,
                body_json: r.get(1)?,
                fetched_at: r.get(2)?,
            })
        },
    )
    .optional()
}

pub fn set_cached(
    conn: &Connection,
    cache_key: &str,
    etag: &str,
    body_json: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO etag_cache (cache_key, etag, body_json, fetched_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(cache_key) DO UPDATE SET
           etag = excluded.etag,
           body_json = excluded.body_json,
           fetched_at = excluded.fetched_at",
        (cache_key, etag, body_json, now_iso()),
    )?;
    Ok(())
}

/// Used by the frontend's "clear cache" path, wired up in Phase 2.
#[allow(dead_code)]
pub fn clear_cache(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM etag_cache", [])?;
    Ok(())
}

#[cfg(test)]
mod tests {
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
}
