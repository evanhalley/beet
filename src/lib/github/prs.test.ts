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
import searchAuthorMe from "@/test/fixtures/search-author-me.json";
import pull412 from "@/test/fixtures/pulls-get-acme-api-412.json";
import pull412Queue from "@/test/fixtures/pulls-get-acme-api-412-queue.json";
import pull700 from "@/test/fixtures/pulls-get-acme-web-700.json";
import checkRuns412 from "@/test/fixtures/commits-check-runs-acme-api-412-failing.json";

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

import {
  countDistinctApprovers,
  deriveLifecycle,
  fetchMyOpenPrs,
  fetchReviewRequests,
} from "./prs";
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
  return HttpResponse.json(body as Parameters<typeof HttpResponse.json>[0], {
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
  lifecycleRows.length = 0;
  ejectionRows.length = 0;
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

    // approval counts from review fixtures
    expect(byId["pr:acme/search#492"].pr?.approvalCount).toBe(1); // octocat APPROVED
    expect(byId["pr:acme/platform#501"].pr?.approvalCount).toBe(0); // empty reviews
    expect(byId["pr:acme/gateway#498"].pr?.approvalCount).toBe(0); // empty reviews

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

describe("countDistinctApprovers", () => {
  test("returns 0 when there are no reviews", () => {
    expect(countDistinctApprovers([])).toBe(0);
  });

  test("counts distinct users who approved", () => {
    expect(
      countDistinctApprovers([
        { user: { login: "rina" }, state: "APPROVED" },
        { user: { login: "mo" }, state: "APPROVED" },
        { user: { login: "kai" }, state: "COMMENTED" },
      ]),
    ).toBe(2);
  });

  test("ignores PENDING events when picking the latest state per user", () => {
    expect(
      countDistinctApprovers([
        { user: { login: "rina" }, state: "APPROVED" },
        { user: { login: "rina" }, state: "PENDING" },
      ]),
    ).toBe(1);
  });

  test("uses the latest non-pending state per user (dismissed approval doesn't count)", () => {
    expect(
      countDistinctApprovers([
        { user: { login: "rina" }, state: "APPROVED" },
        { user: { login: "rina" }, state: "CHANGES_REQUESTED" },
      ]),
    ).toBe(0);
  });

  test("re-approval after a dismissal counts", () => {
    expect(
      countDistinctApprovers([
        { user: { login: "rina" }, state: "APPROVED" },
        { user: { login: "rina" }, state: "DISMISSED" },
        { user: { login: "rina" }, state: "APPROVED" },
      ]),
    ).toBe(1);
  });

  test("ignores reviews with a null user (e.g. deleted account)", () => {
    expect(
      countDistinctApprovers([{ user: null, state: "APPROVED" }]),
    ).toBe(0);
  });
});

describe("deriveLifecycle", () => {
  function pull(overrides: Record<string, unknown>) {
    return {
      number: 1,
      title: "t",
      body: null,
      html_url: "",
      state: "open",
      merged: false,
      auto_merge: null,
      user: { login: "octocat" },
      requested_reviewers: [],
      head: { sha: "x" },
      additions: 0,
      deletions: 0,
      created_at: "",
      updated_at: "",
      ...overrides,
    } as Parameters<typeof deriveLifecycle>[0];
  }

  test("state=closed + merged=true → merged", () => {
    expect(deriveLifecycle(pull({ state: "closed", merged: true }))).toBe("merged");
  });

  test("state=closed + merged=false → closed", () => {
    expect(deriveLifecycle(pull({ state: "closed", merged: false }))).toBe("closed");
  });

  test("auto_merge != null → merge_queue", () => {
    expect(
      deriveLifecycle(pull({ auto_merge: { enabled_by: { login: "octocat" } } })),
    ).toBe("merge_queue");
  });

  test("requested_reviewers non-empty → in_review", () => {
    expect(deriveLifecycle(pull({ requested_reviewers: [{ login: "rina" }] }))).toBe(
      "in_review",
    );
  });

  test("defaults to open", () => {
    expect(deriveLifecycle(pull({}))).toBe("open");
  });

  test("merged trumps in_review (closed PR with stale reviewer list)", () => {
    expect(
      deriveLifecycle(
        pull({
          state: "closed",
          merged: true,
          requested_reviewers: [{ login: "rina" }],
        }),
      ),
    ).toBe("merged");
  });
});

interface MyOpenPrsCounters {
  search: number;
  pull: Record<string, number>;
  comments: Record<string, number>;
  reviews: Record<string, number>;
  checkRuns: Record<string, number>;
}

function newMyOpenCounters(): MyOpenPrsCounters {
  return { search: 0, pull: {}, comments: {}, reviews: {}, checkRuns: {} };
}

interface MyOpenHandlerOpts {
  pull412Body?: unknown;
}

function installMyOpenHandlers(
  c: MyOpenPrsCounters,
  opts: MyOpenHandlerOpts = {},
): void {
  const pull412Resolved = opts.pull412Body ?? pull412;
  server.use(
    http.get("https://api.github.com/search/issues", ({ request }) => {
      c.search += 1;
      return withEtag(request, 'W/"search-author-me"', searchAuthorMe);
    }),
    http.get(
      "https://api.github.com/repos/:owner/:repo/pulls/:num",
      ({ request, params }) => {
        const key = `${params.owner}/${params.repo}#${params.num}`;
        c.pull[key] = (c.pull[key] ?? 0) + 1;
        if (params.owner === "acme" && params.repo === "api" && params.num === "412") {
          return withEtag(request, 'W/"pull-412"', pull412Resolved);
        }
        if (params.owner === "acme" && params.repo === "web" && params.num === "700") {
          return withEtag(request, 'W/"pull-700"', pull700);
        }
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
        return withEtag(request, `W/"reviews-${params.num}"`, reviewsEmpty);
      },
    ),
    http.get(
      "https://api.github.com/repos/:owner/:repo/commits/:ref/check-runs",
      ({ request, params }) => {
        const key = `${params.owner}/${params.repo}@${params.ref}`;
        c.checkRuns[key] = (c.checkRuns[key] ?? 0) + 1;
        return withEtag(request, `W/"checks-${params.ref}"`, checkRuns412);
      },
    ),
  );
}

const myOpenOpts = {
  username: "octocat",
  taskRegex: "https://your-company\\.atlassian\\.net/browse/[A-Z]+-\\d+",
};

describe("fetchMyOpenPrs", () => {
  test("returns ActionableItems for each search hit, sorted by updatedAt desc", async () => {
    const c = newMyOpenCounters();
    installMyOpenHandlers(c);

    const items = await fetchMyOpenPrs(myOpenOpts);

    expect(items).toHaveLength(2);
    // 412 updated 2026-05-12, 700 updated 2026-05-10 → 412 first
    expect(items[0].id).toBe("pr:acme/api#412");
    expect(items[1].id).toBe("pr:acme/web#700");

    for (const item of items) {
      expect(item.pr?.isAuthoredByMe).toBe(true);
    }

    expect(items[0].pr?.lifecycle).toBe("in_review");
    expect(items[1].pr?.lifecycle).toBe("open");
  });

  test("records lifecycle history for each returned PR", async () => {
    installMyOpenHandlers(newMyOpenCounters());
    await fetchMyOpenPrs(myOpenOpts);
    const byPr = lifecycleRows.reduce<Record<string, string[]>>((acc, r) => {
      (acc[r.pr_id] ??= []).push(r.lifecycle);
      return acc;
    }, {});
    expect(byPr["pr:acme/api#412"]).toEqual(["in_review"]);
    expect(byPr["pr:acme/web#700"]).toEqual(["open"]);
  });

  test("detects ejection, fetches failing checks, and flips unread", async () => {
    // Seed: prior poll saw the PR in merge_queue.
    lifecycleRows.push({
      pr_id: "pr:acme/api#412",
      lifecycle: "merge_queue",
      observed_at: "2026-05-11T00:00:00.000Z",
    });

    const c = newMyOpenCounters();
    installMyOpenHandlers(c); // pull412 is open + has a reviewer → in_review

    const items = await fetchMyOpenPrs(myOpenOpts);
    const ejected = items.find((i) => i.id === "pr:acme/api#412");

    expect(ejected).toBeDefined();
    expect(ejected!.unread).toBe(true);
    expect(ejected!.pr?.mergeQueue?.lastEjectionAt).toBeTruthy();
    expect(ejected!.pr?.mergeQueue?.ejectedChecks).toEqual([
      {
        name: "ci/integration",
        conclusion: "failure",
        detailsUrl: "https://github.com/acme/api/runs/123",
      },
    ]);
    // check-runs endpoint hit exactly once for the ejected head SHA.
    expect(c.checkRuns["acme/api@abc1234deadbeef"]).toBe(1);
    // Persisted to pr_ejection_events.
    expect(ejectionRows).toHaveLength(1);
    expect(ejectionRows[0].pr_id).toBe("pr:acme/api#412");
    expect(ejectionRows[0].head_sha).toBe("abc1234deadbeef");
  });

  test("hydrates ejectedChecks from storage when head SHA matches a prior event", async () => {
    ejectionRows.push({
      pr_id: "pr:acme/api#412",
      observed_at: "2026-05-11T00:00:00.000Z",
      head_sha: "abc1234deadbeef",
      failing_checks_json: JSON.stringify([
        { name: "ci/integration", conclusion: "failure", detailsUrl: null },
      ]),
    });
    // No prior merge_queue row → no fresh ejection on this poll.
    installMyOpenHandlers(newMyOpenCounters());

    const items = await fetchMyOpenPrs(myOpenOpts);
    const it = items.find((i) => i.id === "pr:acme/api#412")!;
    // Hydrated rows are marked unread alongside the rest of the In Flight
    // section; the fingerprint system (#8) will eventually distinguish.
    expect(it.unread).toBe(true);
    expect(it.pr?.mergeQueue?.ejectedChecks).toEqual([
      { name: "ci/integration", conclusion: "failure", detailsUrl: null },
    ]);
    expect(it.pr?.mergeQueue?.lastEjectionAt).toBe("2026-05-11T00:00:00.000Z");
  });

  test("a PR currently in the merge queue surfaces mergeQueue state without ejection", async () => {
    const c = newMyOpenCounters();
    installMyOpenHandlers(c, { pull412Body: pull412Queue });

    const items = await fetchMyOpenPrs(myOpenOpts);
    const it = items.find((i) => i.id === "pr:acme/api#412")!;
    expect(it.pr?.lifecycle).toBe("merge_queue");
    expect(it.pr?.mergeQueue).toBeDefined();
    // No check-runs fetch when we're freshly entering the queue (not ejected).
    expect(c.checkRuns).toEqual({});
  });

  test("returns [] when the search has no hits", async () => {
    server.use(
      http.get("https://api.github.com/search/issues", ({ request }) => {
        return withEtag(request, 'W/"search-author-me-empty"', { items: [] });
      }),
    );
    const items = await fetchMyOpenPrs(myOpenOpts);
    expect(items).toEqual([]);
  });
});
