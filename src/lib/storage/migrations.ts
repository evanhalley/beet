/**
 * Mirror of the SQLite migration list owned by Rust
 * (src-tauri/src/lib.rs::migrations). Append-only — never edit a past entry.
 *
 * Source of truth is the Rust list; the plugin runs migrations on init.
 * This TS list exists for documentation and version assertions in tests.
 */
export interface MigrationDescriptor {
  version: number;
  description: string;
  sql: string;
}

export const MIGRATIONS: readonly MigrationDescriptor[] = [
  {
    version: 1,
    description: "create etag_cache table",
    sql: `CREATE TABLE IF NOT EXISTS etag_cache (
      cache_key  TEXT PRIMARY KEY,
      etag       TEXT NOT NULL,
      body_json  TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );`,
  },
  {
    version: 2,
    description: "create pr_lifecycle_history table",
    sql: `CREATE TABLE IF NOT EXISTS pr_lifecycle_history (
      pr_id       TEXT NOT NULL,
      lifecycle   TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      PRIMARY KEY (pr_id, observed_at)
    );`,
  },
  {
    version: 3,
    description: "create pr_ejection_events table",
    sql: `CREATE TABLE IF NOT EXISTS pr_ejection_events (
      pr_id               TEXT NOT NULL,
      observed_at         TEXT NOT NULL,
      head_sha            TEXT NOT NULL,
      failing_checks_json TEXT NOT NULL,
      PRIMARY KEY (pr_id, observed_at)
    );`,
  },
] as const;

export const CURRENT_DB_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
