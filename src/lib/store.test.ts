import { beforeEach, describe, expect, test } from "vitest";
import { selectShowAllReviews, useAppStore } from "./store";
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
