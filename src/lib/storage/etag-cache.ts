import { getDb } from "@/lib/storage/db";

export interface CachedEntry<T> {
  etag: string;
  body: T;
  fetchedAt: string;
}

interface Row {
  etag: string;
  body_json: string;
  fetched_at: string;
}

export async function getCached<T>(cacheKey: string): Promise<CachedEntry<T> | null> {
  const db = await getDb();
  const rows = await db.select<Row[]>(
    "SELECT etag, body_json, fetched_at FROM etag_cache WHERE cache_key = ?",
    [cacheKey],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    etag: row.etag,
    body: JSON.parse(row.body_json) as T,
    fetchedAt: row.fetched_at,
  };
}

export async function setCached<T>(cacheKey: string, etag: string, body: T): Promise<void> {
  const db = await getDb();
  const fetchedAt = new Date().toISOString();
  await db.execute(
    `INSERT INTO etag_cache (cache_key, etag, body_json, fetched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       etag = excluded.etag,
       body_json = excluded.body_json,
       fetched_at = excluded.fetched_at`,
    [cacheKey, etag, JSON.stringify(body), fetchedAt],
  );
}

export async function clearCache(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM etag_cache");
}
