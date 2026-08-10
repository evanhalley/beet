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
#[path = "__tests__/etag_cache.rs"]
mod tests;
