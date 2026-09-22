import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { useAppStore } from "@/lib/store";
import { useTrayBadge } from "../useTrayBadge";
import type { ActionableItem } from "@/lib/types";

function Harness() {
  useTrayBadge();
  return null;
}

function makeReviewItem(n: number, unread: boolean): ActionableItem {
  return {
    id: `pr:org/repo#${n}`,
    kind: "pr",
    title: `PR ${n}`,
    url: `https://github.com/org/repo/pull/${n}`,
    repoFullName: "org/repo",
    updatedAt: "2026-01-01T00:00:00.000Z",
    unread,
    dismissedUntilFingerprint: null,
    pr: {
      number: n,
      author: "alice",
      body: null,
      isAuthoredByMe: false,
      isReviewRequestedFromMe: true,
      isAuthorOnMyTeam: false,
      iveCommented: false,
      iveReviewed: false,
      iveApproved: false,
      approvalCount: 0,
      isDraft: false,
      additions: 10,
      deletions: 5,
      createdAt: "2026-01-01T00:00:00.000Z",
      lifecycle: "in_review",
      mergeQueue: null,
      taskUrls: [],
      score: 5,
      reviewers: null,
      checkRuns: null,
      associatedRuns: null,
    },
  };
}

beforeEach(() => {
  useAppStore.getState().reset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTrayBadge", () => {
  test("invokes set_badge with the unread count", async () => {
    const { invoke } = (await import(
      "@tauri-apps/api/core"
    )) as unknown as { invoke: ReturnType<typeof vi.fn> };
    invoke.mockClear();

    useAppStore.getState().setPollResult({
      reviewRequests: [
        makeReviewItem(1, true),
        makeReviewItem(2, true),
        makeReviewItem(3, false),
      ],
      inFlight: [],
      standaloneRuns: [],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-01-01T00:00:00.000Z",
    });

    render(<Harness />);
    vi.advanceTimersByTime(200);

    expect(invoke).toHaveBeenCalledWith("set_badge", {
      count: 2,
      paused: false,
    });
  });

  test("excludes hidden items (score <= 0) from badge count", async () => {
    const { invoke } = (await import(
      "@tauri-apps/api/core"
    )) as unknown as { invoke: ReturnType<typeof vi.fn> };
    invoke.mockClear();

    const visibleUnread = makeReviewItem(1, true); // score: 5, visible
    const hiddenUnread = makeReviewItem(2, true);
    hiddenUnread.pr!.score = -100; // approved / hidden

    useAppStore.getState().setPollResult({
      reviewRequests: [visibleUnread, hiddenUnread],
      inFlight: [],
      standaloneRuns: [],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-01-01T00:00:00.000Z",
    });

    render(<Harness />);
    vi.advanceTimersByTime(200);

    expect(invoke).toHaveBeenCalledWith("set_badge", {
      count: 1, // only the visible unread item
      paused: false,
    });
  });

  test("counts Needs Action items, and a PR in both lists only once", async () => {
    const { invoke } = (await import(
      "@tauri-apps/api/core"
    )) as unknown as { invoke: ReturnType<typeof vi.fn> };
    invoke.mockClear();

    const mentioned = makeReviewItem(1, true);
    mentioned.pr!.activity = { mentionsMe: 1, replyToMyReview: 0 };
    const mineFailing = makeReviewItem(2, true);
    mineFailing.pr!.isAuthoredByMe = true;
    mineFailing.pr!.isReviewRequestedFromMe = false;
    mineFailing.pr!.checkRuns = [
      { name: "ci", status: "completed", conclusion: "failure" },
    ];
    const mineHealthy = makeReviewItem(3, true);
    mineHealthy.pr!.isAuthoredByMe = true;
    mineHealthy.pr!.checkRuns = [];

    useAppStore.getState().setPollResult({
      reviewRequests: [mentioned],
      inFlight: [mineFailing, mineHealthy],
      standaloneRuns: [],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-01-01T00:00:00.000Z",
    });

    render(<Harness />);
    vi.advanceTimersByTime(200);

    // mentioned (review + needs, counted once) + mineFailing (needs only);
    // healthy in-flight PRs don't count.
    expect(invoke).toHaveBeenCalledWith("set_badge", {
      count: 2,
      paused: false,
    });
  });

  test("includes paused flag", async () => {
    const { invoke } = (await import(
      "@tauri-apps/api/core"
    )) as unknown as { invoke: ReturnType<typeof vi.fn> };
    invoke.mockClear();

    useAppStore.getState().setPaused(true);

    render(<Harness />);
    vi.advanceTimersByTime(200);

    expect(invoke).toHaveBeenCalledWith("set_badge", {
      count: 0,
      paused: true,
    });
  });
});
