import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { VALID_TOKEN } from "@/test/msw-handlers";

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

sqlMod.__fakeDb.select.mockImplementation(async (_sql: string, params: unknown[]) => {
  const key = params[0] as string;
  const r = fakeRows.find((row) => row.cache_key === key);
  return r ? [{ etag: r.etag, body_json: r.body_json, fetched_at: r.fetched_at }] : [];
});

sqlMod.__fakeDb.execute.mockImplementation(async (_sql: string, params: unknown[]) => {
  const [key, etag, body, fetched] = params as [string, string, string, string];
  const existing = fakeRows.findIndex((row) => row.cache_key === key);
  const row = { cache_key: key, etag, body_json: body, fetched_at: fetched };
  if (existing >= 0) fakeRows[existing] = row;
  else fakeRows.push(row);
  return { rowsAffected: 1, lastInsertId: 0 };
});

import { __resetOctokitForTests, beetGet } from "./octokit";
import { __resetDbForTests } from "@/lib/storage/db";

const tokenProvider = async () => VALID_TOKEN;

beforeEach(() => {
  fakeRows.length = 0;
  __resetOctokitForTests();
  __resetDbForTests();
});

afterEach(() => {
  server.resetHandlers();
});

function findRow(key: string): Row | undefined {
  return fakeRows.find((r) => r.cache_key === key);
}

describe("beetGet (ETag-aware wrapper)", () => {
  test("first call: 200 with ETag is cached", async () => {
    let observedIfNoneMatch: string | null = "unset";
    server.use(
      http.get("https://api.github.com/test", ({ request }) => {
        observedIfNoneMatch = request.headers.get("if-none-match");
        return HttpResponse.json(
          { hello: "world" },
          {
            headers: {
              ETag: 'W/"v1"',
              "x-ratelimit-remaining": "4990",
              "x-ratelimit-reset": "1700000100",
            },
          },
        );
      }),
    );

    const result = await beetGet<{ hello: string }>(
      { cacheKey: "test", url: "GET /test" },
      tokenProvider,
    );

    expect(observedIfNoneMatch).toBeNull();
    expect(result.fromCache).toBe(false);
    expect(result.body).toEqual({ hello: "world" });
    expect(result.etag).toBe('W/"v1"');
    expect(result.rateLimit).toEqual({ remaining: 4990, reset: 1700000100 });
    expect(findRow("test")?.etag).toBe('W/"v1"');
  });

  test("second call with same key sends If-None-Match and returns cached body on 304", async () => {
    fakeRows.push({
      cache_key: "test",
      etag: 'W/"v1"',
      body_json: JSON.stringify({ hello: "cached" }),
      fetched_at: new Date().toISOString(),
    });

    let observedIfNoneMatch: string | null = null;
    server.use(
      http.get("https://api.github.com/test", ({ request }) => {
        observedIfNoneMatch = request.headers.get("if-none-match");
        return new HttpResponse(null, {
          status: 304,
          headers: {
            "x-ratelimit-remaining": "4980",
            "x-ratelimit-reset": "1700000200",
          },
        });
      }),
    );

    const result = await beetGet<{ hello: string }>(
      { cacheKey: "test", url: "GET /test" },
      tokenProvider,
    );

    expect(observedIfNoneMatch).toBe('W/"v1"');
    expect(result.fromCache).toBe(true);
    expect(result.body).toEqual({ hello: "cached" });
    expect(result.etag).toBe('W/"v1"');
    expect(result.rateLimit).toEqual({ remaining: 4980, reset: 1700000200 });
  });

  test("200 with new ETag overwrites cached entry", async () => {
    fakeRows.push({
      cache_key: "test",
      etag: 'W/"v1"',
      body_json: JSON.stringify({ hello: "old" }),
      fetched_at: new Date().toISOString(),
    });

    server.use(
      http.get("https://api.github.com/test", () =>
        HttpResponse.json({ hello: "new" }, { headers: { ETag: 'W/"v2"' } }),
      ),
    );

    const result = await beetGet<{ hello: string }>(
      { cacheKey: "test", url: "GET /test" },
      tokenProvider,
    );

    expect(result.fromCache).toBe(false);
    expect(result.body).toEqual({ hello: "new" });
    expect(findRow("test")?.etag).toBe('W/"v2"');
  });

  test("throws NoTokenError when no token is configured", async () => {
    const noToken = async () => null;
    await expect(
      beetGet({ cacheKey: "test", url: "GET /test" }, noToken),
    ).rejects.toMatchObject({ name: "NoTokenError" });
  });
});
