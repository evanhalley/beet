import { beforeEach, describe, expect, test } from "vitest";
import { useAppStore } from "./store";
import type { ActionableItem } from "./types";

function pr(id: string, updatedAt = "2026-05-12T00:00:00Z"): ActionableItem {
  return {
    id,
    kind: "pr",
    title: id,
    url: `https://github.com/acme/repo/pull/${id}`,
    repoFullName: "acme/repo",
    updatedAt,
    unread: false,
    dismissedUntilFingerprint: null,
    pr: {
      number: 1,
      author: "octocat",
      body: null,
      isAuthoredByMe: true,
      isReviewRequestedFromMe: false,
      isAuthorOnMyTeam: false,
      iveCommented: false,
      iveReviewed: false,
      iveApproved: false,
      approvalCount: 0,
      isDraft: false,
      additions: 0,
      deletions: 0,
      createdAt: "2026-05-01T00:00:00Z",
      lifecycle: "open",
      taskUrls: [],
      score: 0,
    },
  };
}

beforeEach(() => {
  useAppStore.getState().reset();
});

describe("store section setters", () => {
  test("cross-section writes coexist in actionableItems", () => {
    const store = useAppStore.getState();
    store.setReviewRequests([pr("rr-a")]);
    store.setInFlight([pr("if-a")]);

    const s = useAppStore.getState();
    expect(s.reviewRequestIds).toEqual(["rr-a"]);
    expect(s.inFlightIds).toEqual(["if-a"]);
    expect(s.actionableItems["rr-a"]).toBeDefined();
    expect(s.actionableItems["if-a"]).toBeDefined();
  });

  test("setReviewRequests([]) GCs review-only items but preserves in-flight items", () => {
    const store = useAppStore.getState();
    store.setReviewRequests([pr("rr-a")]);
    store.setInFlight([pr("if-a")]);
    store.setReviewRequests([]);

    const s = useAppStore.getState();
    expect(s.reviewRequestIds).toEqual([]);
    expect(s.actionableItems["rr-a"]).toBeUndefined();
    expect(s.actionableItems["if-a"]).toBeDefined();
  });

  test("same id in two sections shares a single entry; the latest set wins", () => {
    const store = useAppStore.getState();
    store.setReviewRequests([pr("shared", "2026-05-10T00:00:00Z")]);
    store.setInFlight([pr("shared", "2026-05-12T00:00:00Z")]);

    const s = useAppStore.getState();
    expect(s.reviewRequestIds).toEqual(["shared"]);
    expect(s.inFlightIds).toEqual(["shared"]);
    expect(s.actionableItems["shared"]?.updatedAt).toBe(
      "2026-05-12T00:00:00Z",
    );
  });

  test("removing from one section keeps the item alive if it is still referenced elsewhere", () => {
    const store = useAppStore.getState();
    store.setReviewRequests([pr("shared")]);
    store.setInFlight([pr("shared")]);
    store.setReviewRequests([]);

    const s = useAppStore.getState();
    expect(s.actionableItems["shared"]).toBeDefined();
  });
});
