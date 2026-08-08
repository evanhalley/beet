import { beforeEach, describe, expect, test } from "vitest";
import {
  applySnoozes,
  isReviewRequestVisible,
  isSnoozed,
  selectShowAllReviews,
  useAppStore,
} from "./store";
import type { ActionableItem } from "./types";

beforeEach(() => {
  useAppStore.getState().reset();
});

function prItem(id: string, title: string, author: string): ActionableItem {
  return {
    id,
    kind: "pr",
    title,
    url: `https://github.com/${id.replace("pr:", "")}`,
    repoFullName: id.replace("pr:", "").split("#")[0],
    updatedAt: "2026-05-19T00:00:00.000Z",
    unread: false,
    dismissedUntilFingerprint: null,
    pr: {
      number: Number(id.split("#")[1]),
      author,
      body: null,
      isAuthoredByMe: false,
      isReviewRequestedFromMe: false,
      isAuthorOnMyTeam: false,
      iveCommented: false,
      iveReviewed: false,
      iveApproved: false,
      approvalCount: 0,
      isDraft: false,
      additions: 0,
      deletions: 0,
      createdAt: "2026-05-19T00:00:00.000Z",
      lifecycle: "merged",
      taskUrls: [],
      score: 0,
    },
  };
}

describe("app store (client/UI state)", () => {
  test("setSelectedItemId updates the selection", () => {
    useAppStore.getState().setSelectedItemId("pr:acme/repo#1");
    expect(useAppStore.getState().selectedItemId).toBe("pr:acme/repo#1");
  });

  test("setShowAllReviewsOverride holds a session override", () => {
    useAppStore.getState().setShowAllReviewsOverride(true);
    expect(useAppStore.getState().showAllReviewsOverride).toBe(true);
    useAppStore.getState().setShowAllReviewsOverride(null);
    expect(useAppStore.getState().showAllReviewsOverride).toBeNull();
  });

  test("selectShowAllReviews: override wins over the persisted default", () => {
    useAppStore.getState().setSettings({ showAllApproved: true });
    expect(selectShowAllReviews(useAppStore.getState())).toBe(true);

    useAppStore.getState().setShowAllReviewsOverride(false);
    expect(selectShowAllReviews(useAppStore.getState())).toBe(false);
  });

  test("setSettings merges partial settings", () => {
    useAppStore.getState().setSettings({ taskRegex: "FOO-\\d+" });
    expect(useAppStore.getState().settings.taskRegex).toBe("FOO-\\d+");
  });

  test("toggleListFilter flips a single key independently", () => {
    useAppStore.getState().toggleListFilter("failingOnly");
    expect(useAppStore.getState().listFilters).toEqual({
      failingOnly: true,
      pendingOnly: false,
      myTeamOnly: false,
    });
    useAppStore.getState().toggleListFilter("myTeamOnly");
    expect(useAppStore.getState().listFilters).toEqual({
      failingOnly: true,
      pendingOnly: false,
      myTeamOnly: true,
    });
    useAppStore.getState().toggleListFilter("failingOnly");
    expect(useAppStore.getState().listFilters.failingOnly).toBe(false);
  });

  test("clearListFilters and reset() clear all filters", () => {
    useAppStore.getState().toggleListFilter("failingOnly");
    useAppStore.getState().toggleListFilter("pendingOnly");
    useAppStore.getState().clearListFilters();
    expect(useAppStore.getState().listFilters).toEqual({
      failingOnly: false,
      pendingOnly: false,
      myTeamOnly: false,
    });

    useAppStore.getState().toggleListFilter("myTeamOnly");
    useAppStore.getState().reset();
    expect(useAppStore.getState().listFilters.myTeamOnly).toBe(false);
  });

  test("setRateLimit stores the latest rate-limit snapshot", () => {
    useAppStore
      .getState()
      .setRateLimit({ remaining: 4200, limit: 5000, reset: 1700000000 });
    expect(useAppStore.getState().rateLimit?.remaining).toBe(4200);
  });

  test("recentlyResolved does not overwrite a live PR entry in byId", () => {
    // Regression: when a PR is also present as a live in-flight row, the
    // snapshot-backed resolved row must not stomp the richer live data.
    const live = prItem("pr:acme/repo#1", "Live title", "rina");
    const resolved = prItem("pr:acme/repo#1", "Stale snapshot", "");
    useAppStore.getState().setPollResult({
      reviewRequests: [],
      inFlight: [live],
      standaloneRuns: [],
      recentlyResolved: [resolved],
      rateLimit: null,
      polledAt: "2026-05-19T00:00:00.000Z",
    });
    const hit = useAppStore.getState().byId.get("pr:acme/repo#1");
    expect(hit?.title).toBe("Live title");
    expect(hit?.pr?.author).toBe("rina");
  });

  test("setSuppressedIds stores the suppressed-id list and reset() clears it", () => {
    useAppStore.getState().setSuppressedIds(["pr:acme/repo#1"]);
    expect(useAppStore.getState().suppressedIds).toEqual(["pr:acme/repo#1"]);
    useAppStore.getState().reset();
    expect(useAppStore.getState().suppressedIds).toEqual([]);
  });

  test("reset restores initial state", () => {
    const s = useAppStore.getState();
    s.setSelectedItemId("x");
    s.setUiError("boom");
    s.setShowAllReviewsOverride(true);
    s.reset();

    const after = useAppStore.getState();
    expect(after.selectedItemId).toBeNull();
    expect(after.uiError).toBeNull();
    expect(after.showAllReviewsOverride).toBeNull();
  });
});

describe("isReviewRequestVisible", () => {
  test("hides zero/negative-score items unless Show-All is on", () => {
    const zero = prItem("pr:acme/repo#1", "low", "rina"); // score 0
    expect(isReviewRequestVisible(zero, false)).toBe(false);
    expect(isReviewRequestVisible(zero, true)).toBe(true);

    const positive = prItem("pr:acme/repo#2", "high", "rina");
    positive.pr!.score = 5;
    expect(isReviewRequestVisible(positive, false)).toBe(true);
  });

  test("a suppressed item is hidden even with a positive score, and revealed only by Show-All", () => {
    const item = prItem("pr:acme/repo#3", "wip", "rina");
    item.pr!.score = 8; // would normally be visible
    const suppressed = [item.id];

    // Suppressed + Show-All off → hidden, regardless of score.
    expect(isReviewRequestVisible(item, false, suppressed)).toBe(false);
    // Suppressed + Show-All on → revealed so it can be un-suppressed.
    expect(isReviewRequestVisible(item, true, suppressed)).toBe(true);
    // Not in the suppressed set → unaffected.
    expect(isReviewRequestVisible(item, false, [])).toBe(true);
  });

  test("an actively snoozed item is hidden even with a positive score, and revealed only by Show-All", () => {
    const item = prItem("pr:acme/repo#4", "hot", "rina");
    item.pr!.score = 8;
    const now = Date.parse("2026-08-08T12:00:00.000Z");
    const snoozes = { [item.id]: "2026-08-08T13:00:00.000Z" };

    expect(isReviewRequestVisible(item, false, [], snoozes, now)).toBe(false);
    expect(isReviewRequestVisible(item, true, [], snoozes, now)).toBe(true);
    // Expired snooze → unaffected.
    const expired = { [item.id]: "2026-08-08T11:00:00.000Z" };
    expect(isReviewRequestVisible(item, false, [], expired, now)).toBe(true);
  });
});

describe("isSnoozed / applySnoozes", () => {
  const now = Date.parse("2026-08-08T12:00:00.000Z");

  test("isSnoozed is true only while the until timestamp is in the future", () => {
    expect(isSnoozed("a", { a: "2026-08-08T13:00:00.000Z" }, now)).toBe(true);
    expect(isSnoozed("a", { a: "2026-08-08T11:00:00.000Z" }, now)).toBe(false);
    expect(isSnoozed("a", {}, now)).toBe(false);
    expect(isSnoozed("a", { a: "not-a-date" }, now)).toBe(false);
  });

  test("applySnoozes filters actively snoozed items and keeps the rest", () => {
    const active = prItem("pr:acme/repo#1", "snoozed", "rina");
    const expired = prItem("pr:acme/repo#2", "expired", "rina");
    const untouched = prItem("pr:acme/repo#3", "normal", "rina");
    const snoozes = {
      [active.id]: "2026-08-08T13:00:00.000Z",
      [expired.id]: "2026-08-08T11:00:00.000Z",
    };

    const out = applySnoozes([active, expired, untouched], snoozes, now);
    expect(out.map((i) => i.id)).toEqual([expired.id, untouched.id]);
  });

  test("setSnoozes stores the map and reset() clears it", () => {
    useAppStore.getState().setSnoozes({ "pr:acme/repo#1": "2099-01-01T00:00:00.000Z" });
    expect(useAppStore.getState().snoozes).toEqual({
      "pr:acme/repo#1": "2099-01-01T00:00:00.000Z",
    });
    useAppStore.getState().reset();
    expect(useAppStore.getState().snoozes).toEqual({});
  });
});
