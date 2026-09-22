import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { prCommentsKey, usePrComments } from "../usePrComments";
import type { ActionableItem, PrCommentsResult } from "@/lib/types";

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  invokeMock.mockReset();
});

function prItem(updatedAt = "2026-05-09T10:00:00Z"): ActionableItem {
  return {
    id: "pr:acme/repo#42",
    kind: "pr",
    title: "Patch the migrator",
    url: "https://github.com/acme/repo/pull/42",
    repoFullName: "acme/repo",
    updatedAt,
    unread: false,
    dismissedUntilFingerprint: null,
    pr: {
      number: 42,
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
      additions: 1,
      deletions: 1,
      createdAt: "2026-05-08T10:00:00Z",
      lifecycle: "in_review",
      taskUrls: [],
      score: 3,
    },
  };
}

const result: PrCommentsResult = {
  comments: [
    {
      id: 1,
      kind: "issue",
      author: "rina",
      body: "hi @evan",
      createdAt: "2026-05-09T09:00:00Z",
      htmlUrl: "https://github.com/acme/repo/pull/42#issuecomment-1",
    },
  ],
  username: "evan",
};

describe("prCommentsKey", () => {
  test("changes with updatedAt and is null for non-PR items", () => {
    expect(prCommentsKey(prItem())).toBe("pr:acme/repo#42@2026-05-09T10:00:00Z");
    expect(prCommentsKey(prItem("2026-05-10T00:00:00Z"))).not.toBe(
      prCommentsKey(prItem()),
    );
    expect(prCommentsKey({ ...prItem(), pr: undefined })).toBeNull();
    expect(prCommentsKey(null)).toBeNull();
  });
});

describe("usePrComments", () => {
  test("invokes the command with the PR coordinates", async () => {
    invokeMock.mockResolvedValueOnce(result);
    const { result: hook } = renderHook(() => usePrComments(prItem()));
    expect(hook.current.isLoading).toBe(true);
    await waitFor(() => expect(hook.current.data).toEqual(result));
    expect(invokeMock).toHaveBeenCalledWith("fetch_pr_comments_command", {
      owner: "acme",
      repo: "repo",
      number: 42,
    });
  });

  test("surfaces errors", async () => {
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    const { result: hook } = renderHook(() => usePrComments(prItem()));
    await waitFor(() => expect(hook.current.error).toBe("boom"));
    expect(hook.current.isLoading).toBe(false);
  });

  test("never fetches for non-PR items", () => {
    const { result: hook } = renderHook(() => usePrComments(null));
    expect(hook.current).toEqual({ data: null, isLoading: false, error: null });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test("keeps the previous comments while refetching for a newer updatedAt", async () => {
    invokeMock.mockResolvedValueOnce(result);
    let item = prItem();
    const { result: hook, rerender } = renderHook(() => usePrComments(item));
    await waitFor(() => expect(hook.current.data).toEqual(result));

    invokeMock.mockReturnValueOnce(new Promise(() => {}));
    item = prItem("2026-05-10T00:00:00Z");
    rerender();
    expect(hook.current.isLoading).toBe(false);
    expect(hook.current.data).toEqual(result);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
