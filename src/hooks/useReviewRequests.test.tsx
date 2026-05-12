import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { server } from "@/test/msw-server";
import { VALID_TOKEN } from "@/test/msw-handlers";

import searchFixture from "@/test/fixtures/search-review-requested.json";
import pull501 from "@/test/fixtures/pulls-get-acme-platform-501.json";
import pull498 from "@/test/fixtures/pulls-get-acme-gateway-498.json";
import pull492 from "@/test/fixtures/pulls-get-acme-search-492.json";
import commentsEmpty from "@/test/fixtures/issues-list-comments-empty.json";
import reviewsEmpty from "@/test/fixtures/pulls-list-reviews-empty.json";
import teamMembers from "@/test/fixtures/teams-list-members.json";

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

import { useReviewRequests } from "./useReviewRequests";
import { useAppStore } from "@/lib/store";
import { storeToken } from "@/lib/storage/token";
import { __resetOctokitForTests, setRateLimitListener } from "@/lib/github/octokit";
import { __resetDbForTests } from "@/lib/storage/db";
import { SETTINGS_DEFAULTS } from "@/lib/storage/settings";

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

let searchCalls = 0;

function installHandlers() {
  searchCalls = 0;
  server.use(
    http.get("https://api.github.com/search/issues", () => {
      searchCalls += 1;
      return HttpResponse.json(searchFixture, {
        headers: { ETag: `W/"search-${searchCalls}"`, ...RATE_HEADERS },
      });
    }),
    http.get(
      "https://api.github.com/orgs/:org/teams/:slug/members",
      () =>
        HttpResponse.json(teamMembers, {
          headers: { ETag: 'W/"team"', ...RATE_HEADERS },
        }),
    ),
    http.get(
      "https://api.github.com/repos/:owner/:repo/pulls/:num",
      ({ params }) => {
        const num = params.num;
        const body = num === "501" ? pull501 : num === "498" ? pull498 : pull492;
        return HttpResponse.json(body, {
          headers: { ETag: `W/"pull-${num}"`, ...RATE_HEADERS },
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
  __resetOctokitForTests();
  __resetDbForTests();
  setRateLimitListener(null);
  await storeToken(VALID_TOKEN);
  useAppStore.getState().reset();
  useAppStore.setState({
    user: { login: "octocat" },
    settings: { ...SETTINGS_DEFAULTS, pollingIntervalSec: 15 },
    showAllReviewsOverride: true,
  });
});

afterEach(() => {
  server.resetHandlers();
});

describe("useReviewRequests", () => {
  test("populates the reviewRequests slice on first response", async () => {
    installHandlers();
    const { Wrapper } = makeWrapper();
    renderHook(() => useReviewRequests(), { wrapper: Wrapper });

    await waitFor(() =>
      expect(useAppStore.getState().reviewRequests.length).toBeGreaterThan(0),
    );
    const ids = useAppStore.getState().reviewRequests.map((i) => i.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "pr:acme/platform#501",
        "pr:acme/gateway#498",
        "pr:acme/search#492",
      ]),
    );
  });

  test("does not fetch when username is missing", async () => {
    installHandlers();
    useAppStore.setState({ user: null });
    const { Wrapper } = makeWrapper();
    renderHook(() => useReviewRequests(), { wrapper: Wrapper });
    // Give it a tick — no fetch should fire.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(searchCalls).toBe(0);
    expect(useAppStore.getState().reviewRequests).toEqual([]);
  });

  test("settings change triggers a refetch", async () => {
    installHandlers();
    const { Wrapper } = makeWrapper();
    renderHook(() => useReviewRequests(), { wrapper: Wrapper });

    await waitFor(() => expect(searchCalls).toBe(1));

    // Mutating teams in settings should invalidate the queryKey.
    act(() => {
      useAppStore.getState().setSettings({ teams: ["acme/platform"] });
    });
    await waitFor(() => expect(searchCalls).toBe(2));
  });
});
