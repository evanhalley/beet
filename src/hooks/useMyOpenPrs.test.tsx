import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { server } from "@/test/msw-server";
import { VALID_TOKEN } from "@/test/msw-handlers";

import searchAuthorMe from "@/test/fixtures/search-author-me.json";
import pull412 from "@/test/fixtures/pulls-get-acme-api-412.json";
import pull700 from "@/test/fixtures/pulls-get-acme-web-700.json";
import commentsEmpty from "@/test/fixtures/issues-list-comments-empty.json";
import reviewsEmpty from "@/test/fixtures/pulls-list-reviews-empty.json";

interface Row {
  cache_key: string;
  etag: string;
  body_json: string;
  fetched_at: string;
}

interface LifecycleRow {
  pr_id: string;
  lifecycle: string;
  observed_at: string;
}

interface EjectionRow {
  pr_id: string;
  observed_at: string;
  head_sha: string;
  failing_checks_json: string;
}

const fakeRows: Row[] = [];
const lifecycleRows: LifecycleRow[] = [];
const ejectionRows: EjectionRow[] = [];

const sqlMod = (await vi.importMock("@tauri-apps/plugin-sql")) as unknown as {
  __fakeDb: {
    select: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
  };
};

sqlMod.__fakeDb.select.mockImplementation(async (sql: string, params: unknown[]) => {
  if (sql.includes("FROM pr_lifecycle_history")) {
    const prId = params[0] as string;
    const matches = lifecycleRows
      .filter((r) => r.pr_id === prId)
      .sort((a, b) => b.observed_at.localeCompare(a.observed_at));
    return matches.length ? [{ lifecycle: matches[0].lifecycle }] : [];
  }
  if (sql.includes("FROM pr_ejection_events")) {
    const prId = params[0] as string;
    const matches = ejectionRows
      .filter((r) => r.pr_id === prId)
      .sort((a, b) => b.observed_at.localeCompare(a.observed_at));
    return matches.length
      ? [
          {
            observed_at: matches[0].observed_at,
            head_sha: matches[0].head_sha,
            failing_checks_json: matches[0].failing_checks_json,
          },
        ]
      : [];
  }
  const key = params[0] as string;
  const r = fakeRows.find((row) => row.cache_key === key);
  return r ? [{ etag: r.etag, body_json: r.body_json, fetched_at: r.fetched_at }] : [];
});

sqlMod.__fakeDb.execute.mockImplementation(async (sql: string, params: unknown[]) => {
  if (sql.startsWith("INSERT INTO pr_lifecycle_history")) {
    const [prId, lifecycle, observedAt] = params as [string, string, string];
    lifecycleRows.push({ pr_id: prId, lifecycle, observed_at: observedAt });
    return { rowsAffected: 1, lastInsertId: 0 };
  }
  if (sql.startsWith("INSERT INTO pr_ejection_events")) {
    const [prId, observedAt, headSha, failingChecksJson] = params as [
      string,
      string,
      string,
      string,
    ];
    ejectionRows.push({
      pr_id: prId,
      observed_at: observedAt,
      head_sha: headSha,
      failing_checks_json: failingChecksJson,
    });
    return { rowsAffected: 1, lastInsertId: 0 };
  }
  const [key, etag, body, fetched] = params as [string, string, string, string];
  const existing = fakeRows.findIndex((row) => row.cache_key === key);
  const row = { cache_key: key, etag, body_json: body, fetched_at: fetched };
  if (existing >= 0) fakeRows[existing] = row;
  else fakeRows.push(row);
  return { rowsAffected: 1, lastInsertId: 0 };
});

import { useMyOpenPrs } from "./useMyOpenPrs";
import { useAppStore } from "@/lib/store";
import { storeToken } from "@/lib/storage/token";
import { __resetOctokitForTests, setRateLimitListener } from "@/lib/github/octokit";
import { __resetDbForTests } from "@/lib/storage/db";
import { SETTINGS_DEFAULTS } from "@/lib/storage/settings";
import type { ActionableItem } from "@/lib/types";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { Wrapper, client };
}

const RATE_HEADERS = {
  "x-ratelimit-remaining": "4900",
  "x-ratelimit-limit": "5000",
  "x-ratelimit-reset": "1700000000",
};

function installHandlers() {
  server.use(
    http.get("https://api.github.com/search/issues", () =>
      HttpResponse.json(searchAuthorMe, {
        headers: { ETag: 'W/"search-author"', ...RATE_HEADERS },
      }),
    ),
    http.get(
      "https://api.github.com/repos/:owner/:repo/pulls/:num",
      ({ params }) => {
        const body = params.num === "412" ? pull412 : pull700;
        return HttpResponse.json(body, {
          headers: { ETag: `W/"pull-${params.num}"`, ...RATE_HEADERS },
        });
      },
    ),
    http.get(
      "https://api.github.com/repos/:owner/:repo/issues/:num/comments",
      ({ params }) =>
        HttpResponse.json(commentsEmpty, {
          headers: { ETag: `W/"c-${params.num}"`, ...RATE_HEADERS },
        }),
    ),
    http.get(
      "https://api.github.com/repos/:owner/:repo/pulls/:num/reviews",
      ({ params }) =>
        HttpResponse.json(reviewsEmpty, {
          headers: { ETag: `W/"r-${params.num}"`, ...RATE_HEADERS },
        }),
    ),
  );
}

beforeEach(async () => {
  fakeRows.length = 0;
  lifecycleRows.length = 0;
  ejectionRows.length = 0;
  __resetOctokitForTests();
  __resetDbForTests();
  setRateLimitListener(null);
  await storeToken(VALID_TOKEN);
  useAppStore.getState().reset();
  useAppStore.setState({
    user: { login: "octocat" },
    settings: { ...SETTINGS_DEFAULTS, pollingIntervalSec: 15 },
  });
});

afterEach(() => {
  server.resetHandlers();
});

function rrItem(id: string): ActionableItem {
  return {
    id,
    kind: "pr",
    title: id,
    url: `https://github.com/acme/repo/pull/${id}`,
    repoFullName: "acme/repo",
    updatedAt: "2026-05-12T00:00:00Z",
    unread: false,
    dismissedUntilFingerprint: null,
    pr: {
      number: 1,
      author: "rina",
      isAuthoredByMe: false,
      isReviewRequestedFromMe: true,
      isAuthorOnMyTeam: true,
      iveCommented: false,
      iveReviewed: false,
      iveApproved: false,
      isDraft: false,
      additions: 0,
      deletions: 0,
      createdAt: "2026-05-08T10:00:00Z",
      lifecycle: "in_review",
      taskUrls: [],
      score: 9,
    },
  };
}

describe("useMyOpenPrs", () => {
  test("populates the inFlightIds slice on first response", async () => {
    installHandlers();
    const { Wrapper } = makeWrapper();
    renderHook(() => useMyOpenPrs(), { wrapper: Wrapper });

    await waitFor(() =>
      expect(useAppStore.getState().inFlightIds.length).toBeGreaterThan(0),
    );
    expect(useAppStore.getState().inFlightIds).toEqual(
      expect.arrayContaining(["pr:acme/api#412", "pr:acme/web#700"]),
    );
  });

  test("does not blow away a previously-set review-requests slice", async () => {
    installHandlers();

    // Seed the review-requests slice through the real setter so the store map
    // and id list agree.
    useAppStore.getState().setReviewRequests([rrItem("pr:other/repo#1")]);

    const { Wrapper } = makeWrapper();
    renderHook(() => useMyOpenPrs(), { wrapper: Wrapper });

    await waitFor(() =>
      expect(useAppStore.getState().inFlightIds.length).toBeGreaterThan(0),
    );

    // Review-requests slice still intact + item still resolvable through the map.
    expect(useAppStore.getState().reviewRequestIds).toEqual([
      "pr:other/repo#1",
    ]);
    expect(useAppStore.getState().actionableItems["pr:other/repo#1"]).toBeDefined();
    expect(useAppStore.getState().actionableItems["pr:acme/api#412"]).toBeDefined();
  });

  test("does not fetch when username is missing", async () => {
    let searchCalls = 0;
    server.use(
      http.get("https://api.github.com/search/issues", () => {
        searchCalls += 1;
        return HttpResponse.json(searchAuthorMe);
      }),
    );
    useAppStore.setState({ user: null });
    const { Wrapper } = makeWrapper();
    renderHook(() => useMyOpenPrs(), { wrapper: Wrapper });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(searchCalls).toBe(0);
    expect(useAppStore.getState().inFlightIds).toEqual([]);
  });
});
