import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { usePollEvents } from "../usePollEvents";
import { useAppStore } from "@/lib/store";
import type { ActionableItem } from "@/lib/types";

// `listen` is mocked globally in src/test/setup.ts.

beforeEach(() => {
  useAppStore.getState().reset();
  vi.mocked(listen).mockClear();
});

// The handler usePollEvents passed to `listen` for a given event.
function handlerFor(event: string) {
  const call = vi.mocked(listen).mock.calls.find(([name]) => name === event);
  if (!call) throw new Error(`no listener registered for ${event}`);
  return call[1] as (e: { payload: unknown }) => void;
}

function makeItem(id: string): ActionableItem {
  return {
    id,
    kind: "pr",
    title: `Title ${id}`,
    url: `https://github.com/acme/repo/pull/${id}`,
    repoFullName: "acme/repo",
    updatedAt: "2026-05-12T00:00:00.000Z",
    unread: true,
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
      additions: 1,
      deletions: 1,
      createdAt: "2026-05-11T00:00:00.000Z",
      lifecycle: "open",
      taskUrls: [],
      score: 0,
    },
  };
}

describe("usePollEvents", () => {
  test("subscribes to both poll event channels", async () => {
    renderHook(() => usePollEvents());
    await waitFor(() => {
      expect(listen).toHaveBeenCalledWith("poll:result", expect.any(Function));
      expect(listen).toHaveBeenCalledWith("poll:status", expect.any(Function));
    });
  });

  test("poll:result populates reviewRequests, inFlight, byId, rateLimit", async () => {
    renderHook(() => usePollEvents());
    await waitFor(() => expect(listen).toHaveBeenCalledWith("poll:result", expect.any(Function)));

    const review = makeItem("r1");
    const mine = makeItem("m1");
    handlerFor("poll:result")({
      payload: {
        reviewRequests: [review],
        inFlight: [mine],
        rateLimit: { remaining: 4000, limit: 5000, reset: 1700000000 },
        polledAt: "2026-05-12T12:00:00.000Z",
      },
    });

    const state = useAppStore.getState();
    expect(state.reviewRequests).toEqual([review]);
    expect(state.inFlight).toEqual([mine]);
    expect(state.byId.get("r1")).toEqual(review);
    expect(state.byId.get("m1")).toEqual(mine);
    expect(state.rateLimit?.remaining).toBe(4000);
    expect(state.lastPolledAt).toBe("2026-05-12T12:00:00.000Z");
  });

  test("poll:status drives pollState, pollError and rateLimited", async () => {
    renderHook(() => usePollEvents());
    await waitFor(() => expect(listen).toHaveBeenCalledWith("poll:status", expect.any(Function)));
    const onStatus = handlerFor("poll:status");

    onStatus({
      payload: {
        state: "error",
        error: "GitHub request failed",
        rateLimited: false,
        retryAfterSecs: null,
      },
    });
    expect(useAppStore.getState().pollState).toBe("error");
    expect(useAppStore.getState().pollError).toBe("GitHub request failed");

    // A subsequent good cycle clears the error and reflects rate-limit pressure.
    onStatus({
      payload: { state: "ok", error: null, rateLimited: true, retryAfterSecs: null },
    });
    expect(useAppStore.getState().pollState).toBe("ok");
    expect(useAppStore.getState().pollError).toBeNull();
    expect(useAppStore.getState().rateLimited).toBe(true);
  });

  test("rate-limit errors surface retryAfterSecs to the store", async () => {
    renderHook(() => usePollEvents());
    await waitFor(() => expect(listen).toHaveBeenCalledWith("poll:status", expect.any(Function)));
    handlerFor("poll:status")({
      payload: {
        state: "error",
        error: "GitHub rate limit hit. Retry in 60s.",
        rateLimited: true,
        retryAfterSecs: 60,
      },
    });
    expect(useAppStore.getState().rateLimited).toBe(true);
    expect(useAppStore.getState().retryAfterSecs).toBe(60);
  });
});
