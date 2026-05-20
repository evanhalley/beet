import { describe, expect, test, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { useAppStore } from "@/lib/store";
import { useTrayBadge } from "./useTrayBadge";
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
