import { beforeEach, describe, expect, test, vi } from "vitest";

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

const lifecycleRows: LifecycleRow[] = [];
const ejectionRows: EjectionRow[] = [];

const sqlMod = (await vi.importMock("@tauri-apps/plugin-sql")) as unknown as {
  __fakeDb: {
    select: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
  };
};

const { select, execute } = sqlMod.__fakeDb;

select.mockImplementation(async (sql: string, params: unknown[]) => {
  if (sql.includes("FROM pr_lifecycle_history")) {
    const prId = params[0] as string;
    const matches = lifecycleRows
      .filter((r) => r.pr_id === prId)
      .sort((a, b) => b.observed_at.localeCompare(a.observed_at));
    return matches.length ? [{ lifecycle: matches[0].lifecycle, observed_at: matches[0].observed_at }] : [];
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
  return [];
});

execute.mockImplementation(async (sql: string, params: unknown[]) => {
  if (sql.startsWith("INSERT INTO pr_lifecycle_history")) {
    const [prId, lifecycle, observedAt] = params as [string, string, string];
    lifecycleRows.push({
      pr_id: prId,
      lifecycle,
      observed_at: observedAt,
    });
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
  return { rowsAffected: 0, lastInsertId: 0 };
});

import { __resetDbForTests } from "./db";
import {
  detectEjection,
  getLatestEjectionEvent,
  getLatestLifecycle,
  getLatestLifecycleRow,
  recordEjectionEvent,
  recordLifecycle,
} from "./lifecycle";

let nowMs = 0;

beforeEach(() => {
  lifecycleRows.length = 0;
  ejectionRows.length = 0;
  __resetDbForTests();
  nowMs = Date.UTC(2026, 0, 1, 0, 0, 0);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(nowMs));
});

function tick(ms = 1000) {
  nowMs += ms;
  vi.setSystemTime(new Date(nowMs));
}

describe("recordLifecycle", () => {
  test("inserts a row when there is no prior history", async () => {
    await recordLifecycle("pr:acme/api#1", "open");
    expect(lifecycleRows).toHaveLength(1);
    expect(lifecycleRows[0]).toMatchObject({
      pr_id: "pr:acme/api#1",
      lifecycle: "open",
    });
  });

  test("no-ops when the latest row matches", async () => {
    await recordLifecycle("pr:acme/api#1", "open");
    await recordLifecycle("pr:acme/api#1", "open");
    expect(lifecycleRows).toHaveLength(1);
  });

  test("inserts a new row on a lifecycle transition", async () => {
    await recordLifecycle("pr:acme/api#1", "open");
    tick();
    await recordLifecycle("pr:acme/api#1", "in_review");
    tick();
    await recordLifecycle("pr:acme/api#1", "merge_queue");
    expect(lifecycleRows.map((r) => r.lifecycle)).toEqual([
      "open",
      "in_review",
      "merge_queue",
    ]);
  });
});

describe("getLatestLifecycle", () => {
  test("returns null when nothing has been recorded", async () => {
    expect(await getLatestLifecycle("pr:nope#1")).toBeNull();
  });

  test("returns the most recent lifecycle by observed_at", async () => {
    await recordLifecycle("pr:acme/api#1", "open");
    tick();
    await recordLifecycle("pr:acme/api#1", "in_review");
    expect(await getLatestLifecycle("pr:acme/api#1")).toBe("in_review");
  });
});

describe("getLatestLifecycleRow", () => {
  test("returns null when nothing has been recorded", async () => {
    expect(await getLatestLifecycleRow("pr:nope#1")).toBeNull();
  });

  test("returns the lifecycle plus the transition-in observedAt", async () => {
    await recordLifecycle("pr:acme/api#1", "open");
    tick();
    await recordLifecycle("pr:acme/api#1", "merge_queue");
    const enteredQueueAt = new Date(nowMs).toISOString();
    // No-op polls while still in the queue must not move the timestamp.
    tick();
    await recordLifecycle("pr:acme/api#1", "merge_queue");
    tick();
    await recordLifecycle("pr:acme/api#1", "merge_queue");

    const row = await getLatestLifecycleRow("pr:acme/api#1");
    expect(row?.lifecycle).toBe("merge_queue");
    expect(row?.observedAt).toBe(enteredQueueAt);
  });
});

describe("detectEjection", () => {
  test("returns true on merge_queue → open", async () => {
    await recordLifecycle("pr:acme/api#1", "merge_queue");
    expect(await detectEjection("pr:acme/api#1", "open")).toBe(true);
  });

  test("returns false on merge_queue → merged", async () => {
    await recordLifecycle("pr:acme/api#1", "merge_queue");
    expect(await detectEjection("pr:acme/api#1", "merged")).toBe(false);
  });

  test("returns false on merge_queue → merge_queue (still in queue)", async () => {
    await recordLifecycle("pr:acme/api#1", "merge_queue");
    expect(await detectEjection("pr:acme/api#1", "merge_queue")).toBe(false);
  });

  test("returns false when no prior row exists", async () => {
    expect(await detectEjection("pr:nope#1", "open")).toBe(false);
  });

  test("returns false when prior was not merge_queue", async () => {
    await recordLifecycle("pr:acme/api#1", "in_review");
    expect(await detectEjection("pr:acme/api#1", "open")).toBe(false);
  });
});

describe("recordEjectionEvent / getLatestEjectionEvent", () => {
  test("writes a row with the JSON-encoded failing checks", async () => {
    await recordEjectionEvent("pr:acme/api#1", "abc123", [
      { name: "ci/integration", conclusion: "failure", detailsUrl: null },
    ]);
    expect(ejectionRows).toHaveLength(1);
    expect(ejectionRows[0].head_sha).toBe("abc123");
    expect(JSON.parse(ejectionRows[0].failing_checks_json)).toEqual([
      { name: "ci/integration", conclusion: "failure", detailsUrl: null },
    ]);
  });

  test("getLatestEjectionEvent returns the most recent row decoded", async () => {
    await recordEjectionEvent("pr:acme/api#1", "abc", [
      { name: "old", conclusion: "failure" },
    ]);
    tick();
    await recordEjectionEvent("pr:acme/api#1", "def", [
      { name: "ci/integration", conclusion: "failure" },
    ]);
    const evt = await getLatestEjectionEvent("pr:acme/api#1");
    expect(evt?.headSha).toBe("def");
    expect(evt?.failingChecks).toEqual([
      { name: "ci/integration", conclusion: "failure" },
    ]);
  });

  test("getLatestEjectionEvent returns null when none exists", async () => {
    expect(await getLatestEjectionEvent("pr:nope#1")).toBeNull();
  });
});
