import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/lib/store";
import type { ActionableItem } from "@/lib/types";

const mockInvoke = vi.mocked(invoke);

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
const mockGetNotificationLink = vi.hoisted(() =>
  vi.fn().mockResolvedValue(null),
);
const mockRecordNotificationLink = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
// Deterministic id so tests can assert the send/record/link wiring.
const mockNotifIdFromKey = vi.hoisted(() => vi.fn(() => 123));
// Captures the onNotificationClicked callback so tests can simulate a click.
const mockOnNotificationClicked = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ unregister: vi.fn() }),
);

vi.mock("@choochmeque/tauri-plugin-notifications-api", () => ({
  isPermissionGranted: mockIsPermissionGranted,
  requestPermission: mockRequestPermission,
  sendNotification: mockSendNotification,
  onNotificationClicked: mockOnNotificationClicked,
}));

// `@tauri-apps/api/core` is mocked globally in src/test/setup.ts; reuse that
// invoke so the shared keychain reset keeps working.

vi.mock("@/lib/storage/notifications", () => ({
  checkAndRecord: mockCheckAndRecord,
  getNotificationLink: mockGetNotificationLink,
  recordNotificationLink: mockRecordNotificationLink,
  notifIdFromKey: mockNotifIdFromKey,
}));

import { useNotifications } from "../useNotifications";

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
  mockGetNotificationLink.mockResolvedValue(null);
  mockRecordNotificationLink.mockResolvedValue(undefined);
  mockNotifIdFromKey.mockReturnValue(123);
});

describe("useNotifications", () => {
  test("requests notification permission on mount", async () => {
    renderHook(() => useNotifications());
    await waitFor(() =>
      expect(mockIsPermissionGranted).toHaveBeenCalled(),
    );
  });

  test("clicking a notification selects the linked item and shows the app", async () => {
    mockGetNotificationLink.mockResolvedValue("pr:acme/repo#7");
    renderHook(() => useNotifications());
    await waitFor(() =>
      expect(mockOnNotificationClicked).toHaveBeenCalled(),
    );

    // Simulate macOS delivering a click; the plugin round-trips the numeric id,
    // which resolves to an ActionableItem id via the persisted link map.
    const clickCb = mockOnNotificationClicked.mock.calls[0][0];
    await clickCb({ id: 123 });

    expect(mockGetNotificationLink).toHaveBeenCalledWith(123);
    expect(mockInvoke).toHaveBeenCalledWith("open_main_window");
    expect(useAppStore.getState().pendingNotificationItemId).toBe(
      "pr:acme/repo#7",
    );
  });

  test("clicking a notification with no linked item does nothing", async () => {
    mockGetNotificationLink.mockResolvedValue(null);
    renderHook(() => useNotifications());
    await waitFor(() =>
      expect(mockOnNotificationClicked).toHaveBeenCalled(),
    );

    const clickCb = mockOnNotificationClicked.mock.calls[0][0];
    await clickCb({ id: 999 });

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useAppStore.getState().pendingNotificationItemId).toBeNull();
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
          id: 123,
        }),
      );
    });
    // The id→item link is persisted so the click handler can resolve it.
    expect(mockRecordNotificationLink).toHaveBeenCalledWith(
      123,
      "pr:acme/repo#1",
    );
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
