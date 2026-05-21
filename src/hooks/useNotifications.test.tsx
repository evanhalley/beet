import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAppStore } from "@/lib/store";
import type { ActionableItem } from "@/lib/types";

// ── Mocks ──────────────────────────────────────────────────────────────────
// Use vi.hoisted so these are initialized before vi.mock hoisting runs.

const mockSendNotification = vi.hoisted(() => vi.fn());
const mockIsPermissionGranted = vi.hoisted(() =>
  vi.fn().mockResolvedValue(true),
);
const mockRequestPermission = vi.hoisted(() =>
  vi.fn().mockResolvedValue("granted"),
);
const mockCheckAndRecord = vi.hoisted(() => vi.fn().mockResolvedValue(true));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: mockIsPermissionGranted,
  requestPermission: mockRequestPermission,
  sendNotification: mockSendNotification,
}));

vi.mock("@/lib/storage/notifications", () => ({
  checkAndRecord: mockCheckAndRecord,
}));

import { useNotifications } from "./useNotifications";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeReviewItem(
  id: string,
  overrides: Partial<ActionableItem> = {},
): ActionableItem {
  return {
    id,
    kind: "pr",
    title: `PR ${id}`,
    url: `https://github.com/acme/repo/pull/1`,
    repoFullName: "acme/repo",
    updatedAt: "2026-05-12T10:00:00.000Z",
    unread: false,
    dismissedUntilFingerprint: null,
    pr: {
      number: 1,
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
      createdAt: "2026-05-11T00:00:00.000Z",
      lifecycle: "open",
      taskUrls: [],
      score: 5,
    },
    ...overrides,
  };
}

function makeRunItem(
  id: string,
  status: string,
  conclusion?: string,
): ActionableItem {
  return {
    id,
    kind: "standalone_run",
    title: `CI ${id}`,
    url: `https://github.com/acme/repo/actions/runs/1`,
    repoFullName: "acme/repo",
    updatedAt: "2026-05-12T10:00:00.000Z",
    unread: false,
    dismissedUntilFingerprint: null,
    run: {
      workflowName: "CI",
      event: "push",
      status,
      conclusion,
      branch: "main",
      sha: "abc1234",
      runNumber: 42,
      actorLogin: "me",
      runUrl: "https://github.com/acme/repo/actions/runs/1",
      startedAt: null,
      completedAt: conclusion ? "2026-05-12T10:01:00.000Z" : null,
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  useAppStore.getState().reset();
  vi.clearAllMocks();
  mockIsPermissionGranted.mockResolvedValue(true);
  mockCheckAndRecord.mockResolvedValue(true);
});

describe("useNotifications", () => {
  test("requests notification permission on mount", async () => {
    renderHook(() => useNotifications());
    await waitFor(() =>
      expect(mockIsPermissionGranted).toHaveBeenCalled(),
    );
  });

  test("trigger 3: fires when a new review request appears", async () => {
    renderHook(() => useNotifications());
    // Allow the hook to subscribe and set the initial (empty) baseline.
    await new Promise((r) => setTimeout(r, 0));

    // First tick: empty baseline.
    useAppStore.getState().setPollResult({
      reviewRequests: [],
      inFlight: [],
      standaloneRuns: [],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-05-12T09:00:00.000Z",
    });
    await new Promise((r) => setTimeout(r, 0));

    // Second tick: new review request appears.
    useAppStore.getState().setPollResult({
      reviewRequests: [makeReviewItem("pr:acme/repo#1")],
      inFlight: [],
      standaloneRuns: [],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-05-12T10:00:00.000Z",
    });

    await waitFor(() => {
      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("Review requested"),
        }),
      );
    });
  });

  test("trigger 3: does not fire when checkAndRecord returns false (already sent)", async () => {
    mockCheckAndRecord.mockResolvedValue(false);
    renderHook(() => useNotifications());
    await new Promise((r) => setTimeout(r, 0));

    // Baseline.
    useAppStore.getState().setPollResult({
      reviewRequests: [],
      inFlight: [],
      standaloneRuns: [],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-05-12T09:00:00.000Z",
    });
    await new Promise((r) => setTimeout(r, 0));

    // Second tick: review request appears but dedupe says we already sent it.
    useAppStore.getState().setPollResult({
      reviewRequests: [makeReviewItem("pr:acme/repo#1")],
      inFlight: [],
      standaloneRuns: [],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-05-12T10:00:00.000Z",
    });

    await waitFor(() => expect(mockCheckAndRecord).toHaveBeenCalled());
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  test("trigger 5: fires when a standalone run completes", async () => {
    renderHook(() => useNotifications());
    await new Promise((r) => setTimeout(r, 0));

    // Baseline.
    useAppStore.getState().setPollResult({
      reviewRequests: [],
      inFlight: [],
      standaloneRuns: [],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-05-12T09:00:00.000Z",
    });
    await new Promise((r) => setTimeout(r, 0));

    // Tick: run completes.
    useAppStore.getState().setPollResult({
      reviewRequests: [],
      inFlight: [],
      standaloneRuns: [makeRunItem("run:acme/repo#99", "completed", "success")],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-05-12T10:00:00.000Z",
    });

    await waitFor(() => {
      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("succeeded"),
        }),
      );
    });
  });

  test("trigger 5: does not fire for an already-seen completed run", async () => {
    renderHook(() => useNotifications());
    await new Promise((r) => setTimeout(r, 0));

    const run = makeRunItem("run:acme/repo#99", "completed", "success");

    // Baseline tick with the run already completed — this sets prevRef.
    useAppStore.getState().setPollResult({
      reviewRequests: [],
      inFlight: [],
      standaloneRuns: [run],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-05-12T09:00:00.000Z",
    });
    await new Promise((r) => setTimeout(r, 10));

    // Clear call counts — the above is baseline, notifications may have fired.
    vi.clearAllMocks();
    mockCheckAndRecord.mockResolvedValue(true);

    // Second tick with same run — should not fire again because the run was
    // already in prevRef.completedRunIds.
    useAppStore.getState().setPollResult({
      reviewRequests: [],
      inFlight: [],
      standaloneRuns: [run],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-05-12T10:00:00.000Z",
    });
    await new Promise((r) => setTimeout(r, 50));

    // The second tick should not call checkAndRecord for the already-known run.
    expect(mockCheckAndRecord).not.toHaveBeenCalledWith(
      expect.stringContaining("run:run:acme/repo#99:success"),
    );
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  test("toggle off: review request notification skipped when disabled", async () => {
    useAppStore
      .getState()
      .setSettings({ notifyOnReviewRequest: false });
    renderHook(() => useNotifications());
    await new Promise((r) => setTimeout(r, 0));

    useAppStore.getState().setPollResult({
      reviewRequests: [],
      inFlight: [],
      standaloneRuns: [],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-05-12T09:00:00.000Z",
    });
    await new Promise((r) => setTimeout(r, 0));

    useAppStore.getState().setPollResult({
      reviewRequests: [makeReviewItem("pr:acme/repo#1")],
      inFlight: [],
      standaloneRuns: [],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-05-12T10:00:00.000Z",
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});
