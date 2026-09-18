import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { diffUrl, ownedFilesUrl, prFilesKey, usePrFiles } from "../usePrFiles";
import type { ActionableItem, PrFilesResult } from "@/lib/types";

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  invokeMock.mockReset();
});

function prItem(overrides: Partial<ActionableItem["pr"]> = {}): ActionableItem {
  return {
    id: "pr:acme/repo#42",
    kind: "pr",
    title: "Patch the migrator",
    url: "https://github.com/acme/repo/pull/42",
    repoFullName: "acme/repo",
    updatedAt: "2026-05-09T10:00:00Z",
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
      additions: 12,
      deletions: 3,
      createdAt: "2026-05-08T10:00:00Z",
      lifecycle: "in_review",
      taskUrls: [],
      score: 9,
      headSha: "head1",
      baseRef: "main",
      baseSha: "base1",
      ...overrides,
    },
  };
}

function runItem(): ActionableItem {
  return {
    id: "run:acme/repo#7",
    kind: "standalone_run",
    title: "Deploy",
    url: "https://github.com/acme/repo/actions/runs/7",
    repoFullName: "acme/repo",
    updatedAt: "2026-05-09T10:00:00Z",
    unread: false,
    dismissedUntilFingerprint: null,
    run: {
      workflowName: "Deploy",
      event: "push",
      status: "completed",
      conclusion: "success",
      branch: "main",
      sha: "deadbeef",
      runNumber: 7,
      actorLogin: "evan",
      runUrl: "https://github.com/acme/repo/actions/runs/7",
      startedAt: null,
      completedAt: null,
    },
  };
}

const result: PrFilesResult = {
  files: [],
  hasCodeowners: true,
  codeownersPath: ".github/CODEOWNERS",
  teamsResolved: true,
  ownedCount: 0,
  totalCount: 0,
  truncated: false,
  username: "evan",
};

describe("url helpers", () => {
  test("ownedFilesUrl opens the Files tab with GitHub's owned-by filter", () => {
    expect(ownedFilesUrl("https://github.com/acme/repo/pull/42", "evan")).toBe(
      "https://github.com/acme/repo/pull/42/files?owned-by%5B%5D=evan",
    );
  });

  test("ownedFilesUrl encodes the username", () => {
    expect(ownedFilesUrl("https://github.com/a/r/pull/1", "e v&n")).toBe(
      "https://github.com/a/r/pull/1/files?owned-by%5B%5D=e%20v%26n",
    );
  });

  test("diffUrl points at the file anchor, with the owned-by filter only when asked", () => {
    expect(diffUrl("https://github.com/acme/repo/pull/42", "diff-abc")).toBe(
      "https://github.com/acme/repo/pull/42/files#diff-abc",
    );
    expect(diffUrl("https://github.com/acme/repo/pull/42", "diff-abc", "evan")).toBe(
      "https://github.com/acme/repo/pull/42/files?owned-by%5B%5D=evan#diff-abc",
    );
  });

  test("prFilesKey changes with the head sha and is null for non-PR items", () => {
    expect(prFilesKey(prItem())).toBe("pr:acme/repo#42@head1");
    expect(prFilesKey(prItem({ headSha: "head2" }))).toBe("pr:acme/repo#42@head2");
    expect(prFilesKey(prItem({ headSha: undefined }))).toBe("pr:acme/repo#42@");
    expect(prFilesKey(runItem())).toBeNull();
    expect(prFilesKey(null)).toBeNull();
  });
});

describe("usePrFiles", () => {
  test("invokes the files command with the PR coordinates", async () => {
    invokeMock.mockResolvedValue(result);
    const { result: hook } = renderHook(() => usePrFiles(prItem()));
    expect(hook.current.isLoading).toBe(true);
    await waitFor(() => expect(hook.current.isLoading).toBe(false));
    expect(hook.current.data).toEqual(result);
    expect(hook.current.error).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("fetch_pr_files_command", {
      owner: "acme",
      repo: "repo",
      number: 42,
      headSha: "head1",
      baseRef: "main",
      baseSha: "base1",
    });
  });

  test("does nothing for run items or when nothing is selected", () => {
    const { result: a } = renderHook(() => usePrFiles(runItem()));
    const { result: b } = renderHook(() => usePrFiles(null));
    expect(a.current).toEqual({ data: null, isLoading: false, error: null });
    expect(b.current).toEqual({ data: null, isLoading: false, error: null });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test("re-renders with the same item do not refetch; a new head sha does", async () => {
    invokeMock.mockResolvedValue(result);
    const { result: hook, rerender } = renderHook(({ item }) => usePrFiles(item), {
      initialProps: { item: prItem() },
    });
    await waitFor(() => expect(hook.current.isLoading).toBe(false));
    rerender({ item: prItem() });
    rerender({ item: { ...prItem() } });
    expect(invokeMock).toHaveBeenCalledTimes(1);

    rerender({ item: prItem({ headSha: "head2" }) });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
  });

  test("surfaces command errors", async () => {
    invokeMock.mockRejectedValue(new Error("no PAT configured"));
    const { result: hook } = renderHook(() => usePrFiles(prItem()));
    await waitFor(() => expect(hook.current.isLoading).toBe(false));
    expect(hook.current.error).toBe("no PAT configured");
    expect(hook.current.data).toBeNull();
  });

  test("discards a stale result when the selection changes mid-flight", async () => {
    let resolveFirst: (r: PrFilesResult) => void = () => {};
    invokeMock.mockImplementationOnce(
      () => new Promise<PrFilesResult>((res) => (resolveFirst = res)),
    );
    invokeMock.mockResolvedValueOnce({ ...result, username: "second" });

    const { result: hook, rerender } = renderHook(({ item }) => usePrFiles(item), {
      initialProps: { item: prItem() },
    });
    rerender({ item: { ...prItem({ number: 43 }), id: "pr:acme/repo#43" } });
    resolveFirst({ ...result, username: "first" });
    await waitFor(() => expect(hook.current.isLoading).toBe(false));
    expect(hook.current.data?.username).toBe("second");
  });
});
