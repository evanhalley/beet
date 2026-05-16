import { beforeEach, describe, expect, test } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSelectedItem } from "./useSelectedItem";
import { useAppStore } from "@/lib/store";
import { SETTINGS_DEFAULTS } from "@/lib/storage/settings";
import type { ActionableItem } from "@/lib/types";

function reviewItem(id: string, score: number): ActionableItem {
  return {
    id,
    kind: "pr",
    title: `Title ${id}`,
    url: `https://github.com/acme/repo/pull/${id}`,
    repoFullName: "acme/repo",
    updatedAt: "2026-05-09T10:00:00Z",
    unread: false,
    dismissedUntilFingerprint: null,
    pr: {
      number: 1,
      author: "rina",
      body: null,
      isAuthoredByMe: false,
      isReviewRequestedFromMe: true,
      isAuthorOnMyTeam: false,
      iveCommented: false,
      iveReviewed: false,
      iveApproved: false,
      approvalCount: 0,
      isDraft: false,
      additions: 0,
      deletions: 0,
      createdAt: "2026-05-08T10:00:00Z",
      lifecycle: "in_review",
      taskUrls: [],
      score,
    },
  };
}

function seedReviewRequests(items: ActionableItem[]) {
  useAppStore.getState().setPollResult({
    reviewRequests: items,
    inFlight: [],
    rateLimit: null,
    polledAt: "2026-05-12T00:00:00.000Z",
  });
}

beforeEach(() => {
  useAppStore.getState().reset();
});

describe("useSelectedItem", () => {
  test("returns null when nothing is selected", () => {
    seedReviewRequests([reviewItem("a", 5)]);
    const { result } = renderHook(() => useSelectedItem());
    expect(result.current).toBeNull();
  });

  test("resolves a visible review-request selection", () => {
    seedReviewRequests([reviewItem("a", 5)]);
    useAppStore.setState({ selectedItemId: "a" });
    const { result } = renderHook(() => useSelectedItem());
    expect(result.current?.id).toBe("a");
  });

  test("returns null for a ghost id with no matching item", () => {
    seedReviewRequests([reviewItem("a", 5)]);
    useAppStore.setState({ selectedItemId: "missing" });
    const { result } = renderHook(() => useSelectedItem());
    expect(result.current).toBeNull();
  });

  test("hides a now-invisible review-request when Show-All is off", () => {
    // Selected while approved (visible only under Show-All). With Show-All
    // off the selection must drop so MainWindowShell's auto-pick can repair.
    seedReviewRequests([reviewItem("approved", 0), reviewItem("visible", 4)]);
    useAppStore.setState({
      selectedItemId: "approved",
      showAllReviewsOverride: false,
      settings: { ...SETTINGS_DEFAULTS, showAllApproved: false },
    });
    const { result } = renderHook(() => useSelectedItem());
    expect(result.current).toBeNull();
  });

  test("keeps the selection visible when Show-All is on", () => {
    seedReviewRequests([reviewItem("approved", 0)]);
    useAppStore.setState({
      selectedItemId: "approved",
      showAllReviewsOverride: true,
    });
    const { result } = renderHook(() => useSelectedItem());
    expect(result.current?.id).toBe("approved");
  });
});
