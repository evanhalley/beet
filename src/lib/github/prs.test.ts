import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { VALID_TOKEN } from "@/test/msw-handlers";

import searchFixture from "@/test/fixtures/search-review-requested.json";
import pull501 from "@/test/fixtures/pulls-get-acme-platform-501.json";
import pull498 from "@/test/fixtures/pulls-get-acme-gateway-498.json";
import pull492 from "@/test/fixtures/pulls-get-acme-search-492.json";
import commentsEmpty from "@/test/fixtures/issues-list-comments-empty.json";
import reviewsEmpty from "@/test/fixtures/pulls-list-reviews-empty.json";
import reviewsApproved from "@/test/fixtures/pulls-list-reviews-mo-approved.json";
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

import { fetchReviewRequests } from "./prs";
import { __resetOctokitForTests, setRateLimitListener } from "@/lib/github/octokit";
import { __resetDbForTests } from "@/lib/storage/db";
import { storeToken } from "@/lib/storage/token";

const RATE_HEADERS = {
  "x-ratelimit-remaining": "4990",
  "x-ratelimit-limit": "5000",
  "x-ratelimit-reset": "1700000000",
};

interface RequestCounters {
  search: number;
  team: number;
  pull: Record<string, number>;
  comments: Record<string, number>;
  reviews: Record<string, number>;
}

function newCounters(): RequestCounters {
  return { search: 0, team: 0, pull: {}, comments: {}, reviews: {} };
}

function withEtag(
  request: Request,
  etag: string,
  body: unknown,
): Response {
  const inm = request.headers.get("if-none-match");
  if (inm && inm === etag) {
    return new HttpResponse(null, {
      status: 304,
      headers: { ETag: etag, ...RATE_HEADERS },
    });
  }
  return HttpResponse.json(body, {
    headers: { ETag: etag, ...RATE_HEADERS },
  });
}

function installDefaultHandlers(c: RequestCounters): void {
  server.use(
    http.get("https://api.github.com/search/issues", ({ request }) => {
      c.search += 1;
      return withEtag(request, 'W/"search"', searchFixture);
    }),
    http.get(
      "https://api.github.com/orgs/:org/teams/:slug/members",
      ({ request }) => {
        c.team += 1;
        return withEtag(request, 'W/"team"', teamMembers);
      },
    ),
    http.get(
      "https://api.github.com/repos/:owner/:repo/pulls/:num",
      ({ request, params }) => {
        const key = `${params.owner}/${params.repo}#${params.num}`;
        c.pull[key] = (c.pull[key] ?? 0) + 1;
        if (params.num === "501") return withEtag(request, 'W/"pull-501"', pull501);
        if (params.num === "498") return withEtag(request, 'W/"pull-498"', pull498);
        if (params.num === "492") return withEtag(request, 'W/"pull-492"', pull492);
        return new HttpResponse("not found", { status: 404 });
      },
    ),
    http.get(
      "https://api.github.com/repos/:owner/:repo/issues/:num/comments",
      ({ request, params }) => {
        const key = `${params.owner}/${params.repo}#${params.num}`;
        c.comments[key] = (c.comments[key] ?? 0) + 1;
        return withEtag(request, `W/"comments-${params.num}"`, commentsEmpty);
      },
    ),
    http.get(
      "https://api.github.com/repos/:owner/:repo/pulls/:num/reviews",
      ({ request, params }) => {
        const key = `${params.owner}/${params.repo}#${params.num}`;
        c.reviews[key] = (c.reviews[key] ?? 0) + 1;
        // Mo (#492) has an APPROVED review from octocat → demote to negative score.
        const body = params.num === "492" ? reviewsApproved : reviewsEmpty;
        return withEtag(request, `W/"reviews-${params.num}"`, body);
      },
    ),
  );
}

const defaultOpts = {
  username: "octocat",
  teams: ["acme/platform"],
  penalizedBots: [] as string[],
  taskRegex:
    "https://your-company\\.atlassian\\.net/browse/[A-Z]+-\\d+",
  showAll: true,
};

beforeEach(async () => {
  fakeRows.length = 0;
  __resetOctokitForTests();
  __resetDbForTests();
  setRateLimitListener(null);
  await storeToken(VALID_TOKEN);
});

afterEach(() => {
  server.resetHandlers();
});

describe("fetchReviewRequests", () => {
  test("returns scored ActionableItems for each search hit", async () => {
    const c = newCounters();
    installDefaultHandlers(c);

    const items = await fetchReviewRequests(defaultOpts);

    expect(items).toHaveLength(3);
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId["pr:acme/platform#501"]).toBeDefined();
    expect(byId["pr:acme/gateway#498"]).toBeDefined();
    expect(byId["pr:acme/search#492"]).toBeDefined();

    // rina is in team acme/platform → +6 team, +3 reviewer = 9
    expect(byId["pr:acme/platform#501"].pr?.score).toBe(9);
    // mo: reviewer +3, approved -100 → very negative
    expect(byId["pr:acme/search#492"].pr?.score).toBeLessThan(0);
    // kai (#498): draft, no reviewer, no team → -5
    expect(byId["pr:acme/gateway#498"].pr?.score).toBeLessThan(0);

    // task URLs extracted on #501
    expect(byId["pr:acme/platform#501"].pr?.taskUrls).toEqual([
      "https://your-company.atlassian.net/browse/PLAT-100",
      "https://your-company.atlassian.net/browse/PLAT-101",
    ]);

    // team membership picks up rina via teams fixture
    expect(byId["pr:acme/platform#501"].pr?.isAuthorOnMyTeam).toBe(true);
    expect(byId["pr:acme/gateway#498"].pr?.isAuthorOnMyTeam).toBe(false);

    // Sorted desc by score (showAll = true so all kept)
    const scores = items.map((i) => i.pr?.score ?? 0);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  test("returns [] without firing detail fetches when search is empty", async () => {
    const c = newCounters();
    server.use(
      http.get("https://api.github.com/search/issues", ({ request }) => {
        c.search += 1;
        return withEtag(request, 'W/"search-empty"', { items: [] });
      }),
    );
    const items = await fetchReviewRequests(defaultOpts);
    expect(items).toEqual([]);
    expect(c.search).toBe(1);
    expect(Object.keys(c.pull)).toHaveLength(0);
  });

  test("drops PRs whose pulls.get returns a null user (deleted account)", async () => {
    const c = newCounters();
    installDefaultHandlers(c);
    const ghost = { ...pull501, user: null };
    server.use(
      http.get(
        "https://api.github.com/repos/acme/platform/pulls/501",
        ({ request }) => withEtag(request, 'W/"pull-501-ghost"', ghost),
      ),
    );

    const items = await fetchReviewRequests(defaultOpts);
    const ids = items.map((i) => i.id);
    expect(ids).not.toContain("pr:acme/platform#501");
    expect(ids).toContain("pr:acme/gateway#498");
    expect(ids).toContain("pr:acme/search#492");
  });

  test("drops PRs whose detail fetch errors and returns the rest", async () => {
    const c = newCounters();
    installDefaultHandlers(c);
    server.use(
      http.get(
        "https://api.github.com/repos/acme/platform/pulls/501",
        () => new HttpResponse("boom", { status: 500 }),
      ),
    );

    const items = await fetchReviewRequests(defaultOpts);
    const ids = items.map((i) => i.id);
    expect(ids).not.toContain("pr:acme/platform#501");
    expect(ids).toContain("pr:acme/gateway#498");
    expect(ids).toContain("pr:acme/search#492");
  });

  test("invokes team membership resolution and plumbs into isAuthorOnMyTeam", async () => {
    const c = newCounters();
    installDefaultHandlers(c);
    await fetchReviewRequests(defaultOpts);
    expect(c.team).toBe(1);
  });

  test("second invocation hits 304 on every cached call", async () => {
    const c = newCounters();
    installDefaultHandlers(c);

    await fetchReviewRequests(defaultOpts);
    // Reset only the request counters; keep the etag cache and MSW handlers.
    const c2 = newCounters();
    server.resetHandlers();
    installDefaultHandlers(c2);

    let saw304 = 0;
    server.events.on("response:mocked", ({ response }) => {
      if (response.status === 304) saw304 += 1;
    });

    await fetchReviewRequests(defaultOpts);
    // 1 search + 1 team + 3 pulls + 3 comments + 3 reviews = 11
    expect(saw304).toBe(11);
    server.events.removeAllListeners("response:mocked");
  });
});
