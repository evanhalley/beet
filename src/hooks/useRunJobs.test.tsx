import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { parseRunItemId, useRunJobs } from "./useRunJobs";
import type { ActionableItem, WorkflowJobSummary } from "@/lib/types";

// `@tauri-apps/api/core` is already mocked in src/test/setup.ts (the global
// mock backs storeToken / getToken / clearToken with an in-memory keychain).
// Cast to the Vitest mock surface so we can stub `invoke` per test.
const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  // The global setup re-installs the fake-keychain implementation on every
  // call; we override per test below. Reset clears any pending overrides.
  invokeMock.mockReset();
});

afterEach(() => {
  invokeMock.mockReset();
});

function runItem(id: string): ActionableItem {
  return {
    id,
    kind: "standalone_run",
    title: "Deploy",
    url: "https://github.com/foo/bar/actions/runs/42",
    repoFullName: "foo/bar",
    updatedAt: "2026-01-01T00:00:00.000Z",
    unread: false,
    dismissedUntilFingerprint: null,
    run: {
      workflowName: "Deploy",
      event: "push",
      status: "completed",
      conclusion: "success",
      branch: "main",
      sha: "deadbeef",
      runNumber: 42,
      actorLogin: "evan",
      runUrl: "https://github.com/foo/bar/actions/runs/42",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z",
    },
  };
}

describe("parseRunItemId", () => {
  test("parses run:{owner}/{repo}#{runId}", () => {
    expect(parseRunItemId("run:foo/bar#42")).toEqual({
      owner: "foo",
      repo: "bar",
      runId: 42,
    });
  });

  test("returns null for ids that aren't run-shaped", () => {
    expect(parseRunItemId("pr:foo/bar#42")).toBeNull();
    expect(parseRunItemId("run:foo/bar")).toBeNull();
    expect(parseRunItemId("run:foo#42")).toBeNull();
    expect(parseRunItemId("run:foo/bar#abc")).toBeNull();
  });
});

describe("useRunJobs", () => {
  test("invokes fetch_run_jobs_command and returns the jobs on success", async () => {
    const jobs: WorkflowJobSummary[] = [
      { id: 1, name: "build", status: "completed", conclusion: "success" },
    ];
    invokeMock.mockResolvedValueOnce(jobs);

    const { result } = renderHook(() => useRunJobs(runItem("run:foo/bar#42")));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.jobs).toEqual(jobs);
    expect(result.current.error).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("fetch_run_jobs_command", {
      owner: "foo",
      repo: "bar",
      runId: 42,
    });
  });

  test("surfaces command errors as a string", async () => {
    invokeMock.mockRejectedValueOnce(new Error("rate limit"));

    const { result } = renderHook(() => useRunJobs(runItem("run:foo/bar#42")));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("rate limit");
    expect(result.current.jobs).toEqual([]);
  });

  test("returns empty + idle when given a null item or a PR row", () => {
    const { result: nullRes } = renderHook(() => useRunJobs(null));
    expect(nullRes.current).toEqual({ jobs: [], isLoading: false, error: null });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test("cancels in-flight fetches when the selected run changes", async () => {
    // Slow first call; resolve only after the second selection has fired.
    let resolveFirst!: (v: WorkflowJobSummary[]) => void;
    const firstPromise = new Promise<WorkflowJobSummary[]>((res) => {
      resolveFirst = res;
    });
    invokeMock
      .mockReturnValueOnce(firstPromise as unknown as Promise<unknown>)
      .mockResolvedValueOnce([
        { id: 2, name: "second", status: "completed", conclusion: "success" },
      ]);

    const { result, rerender } = renderHook(
      ({ item }: { item: ActionableItem }) => useRunJobs(item),
      { initialProps: { item: runItem("run:foo/bar#1") } },
    );
    expect(result.current.isLoading).toBe(true);

    rerender({ item: runItem("run:foo/bar#2") });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.jobs.map((j) => j.id)).toEqual([2]);

    // The first call resolving now must not overwrite the second result.
    await act(async () => {
      resolveFirst([{ id: 99, name: "stale", status: "completed" }]);
      await firstPromise;
    });
    expect(result.current.jobs.map((j) => j.id)).toEqual([2]);
  });
});
