import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MIGRATIONS } from "./migrations";

interface RustMigration {
  version: number;
  description: string;
  sql: string;
}

/**
 * Parse the `migrations()` vec from src-tauri/src/lib.rs.
 *
 * The expected shape inside `fn migrations()` is repeated blocks like:
 *
 *     Migration {
 *         version: 1,
 *         description: "create etag_cache table",
 *         sql: "CREATE TABLE ...",
 *         kind: MigrationKind::Up,
 *     }
 *
 * The parser is intentionally narrow: if the format drifts, the test fails
 * loudly so we keep the two lists in sync.
 */
function parseRustMigrations(source: string): RustMigration[] {
  const fnMatch = source.match(/fn migrations\(\)[^{]*\{([\s\S]*?)^}/m);
  if (!fnMatch) throw new Error("Could not locate `fn migrations()` in lib.rs");

  const body = fnMatch[1];
  const blockRe = /Migration\s*\{([\s\S]*?)\}/g;
  const out: RustMigration[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(body))) {
    const inner = m[1];
    const version = Number(/version:\s*(\d+)/.exec(inner)?.[1]);
    const description = /description:\s*"((?:\\.|[^"\\])*)"/.exec(inner)?.[1];
    const sql = /sql:\s*"((?:\\.|[^"\\])*)"/.exec(inner)?.[1];
    if (Number.isNaN(version) || description === undefined || sql === undefined) {
      throw new Error(`Failed to parse Migration block: ${inner}`);
    }
    out.push({ version, description, sql });
  }
  return out;
}

function normalizeSql(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

describe("migrations parity (Rust ↔ TS)", () => {
  const rustSource = readFileSync(
    resolve(__dirname, "../../../src-tauri/src/lib.rs"),
    "utf8",
  );
  const rustMigrations = parseRustMigrations(rustSource);

  test("same number of migrations on both sides", () => {
    expect(rustMigrations.length).toBe(MIGRATIONS.length);
  });

  test("each migration matches by version, description, and SQL", () => {
    for (let i = 0; i < MIGRATIONS.length; i++) {
      const ts = MIGRATIONS[i];
      const rust = rustMigrations[i];
      expect(rust.version).toBe(ts.version);
      expect(rust.description).toBe(ts.description);
      expect(normalizeSql(rust.sql)).toBe(normalizeSql(ts.sql));
    }
  });
});
