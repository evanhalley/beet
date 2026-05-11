import { beforeEach, describe, expect, test, vi } from "vitest";

interface Row {
  cache_key: string;
  etag: string;
  body_json: string;
  fetched_at: string;
}

const fakeRows: Row[] = [];

const sqlMod = (await vi.importMock("@tauri-apps/plugin-sql")) as unknown as {
  __fakeDb: {
    select: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
  };
};

const { select, execute } = sqlMod.__fakeDb;

select.mockImplementation(async (_sql: string, params: unknown[]) => {
  const key = params[0] as string;
  const r = fakeRows.find((row) => row.cache_key === key);
  return r ? [{ etag: r.etag, body_json: r.body_json, fetched_at: r.fetched_at }] : [];
});

execute.mockImplementation(async (_sql: string, params: unknown[]) => {
  const [key, etag, body, fetched] = params as [string, string, string, string];
  const existing = fakeRows.findIndex((row) => row.cache_key === key);
  const row = { cache_key: key, etag, body_json: body, fetched_at: fetched };
  if (existing >= 0) fakeRows[existing] = row;
  else fakeRows.push(row);
  return { rowsAffected: 1, lastInsertId: 0 };
});

import { __resetDbForTests } from "./db";
import { getCached, setCached } from "./etag-cache";

beforeEach(() => {
  fakeRows.length = 0;
  __resetDbForTests();
});

describe("etag-cache", () => {
  test("returns null when key is absent", async () => {
    expect(await getCached("missing")).toBeNull();
  });

  test("round-trips body and etag", async () => {
    await setCached("user", 'W/"abc"', { login: "octocat" });
    const cached = await getCached<{ login: string }>("user");
    expect(cached?.etag).toBe('W/"abc"');
    expect(cached?.body).toEqual({ login: "octocat" });
    expect(cached?.fetchedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  test("overwrites existing entry on conflict", async () => {
    await setCached("user", "etag-1", { login: "first" });
    await setCached("user", "etag-2", { login: "second" });
    const cached = await getCached<{ login: string }>("user");
    expect(cached?.etag).toBe("etag-2");
    expect(cached?.body).toEqual({ login: "second" });
    expect(fakeRows).toHaveLength(1);
  });
});
