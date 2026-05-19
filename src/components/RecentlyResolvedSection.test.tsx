import { describe, expect, test, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useAppStore } from "@/lib/store";
import type { ActionableItem } from "@/lib/types";
import { RecentlyResolvedSection } from "./RecentlyResolvedSection";

function mergedPr(id: string, title: string): ActionableItem {
  return {
    id: `pr:${id}`,
    kind: "pr",
    title,
    url: `https://github.com/${id}`,
    repoFullName: id.split("#")[0],
    updatedAt: "2026-01-02T00:00:00.000Z",
    unread: false,
    dismissedUntilFingerprint: null,
    pr: {
      number: 1,
      author: "rina",
      body: null,
      isAuthoredByMe: false,
      isReviewRequestedFromMe: false,
      isAuthorOnMyTeam: false,
      iveCommented: false,
      iveReviewed: false,
      iveApproved: false,
      approvalCount: 0,
      isDraft: false,
      additions: 0,
      deletions: 0,
      createdAt: "2026-01-02T00:00:00.000Z",
      lifecycle: "merged",
      taskUrls: [],
      score: 0,
    },
  };
}

function completedRun(id: number, workflowName: string): ActionableItem {
  return {
    id: `run:foo/bar#${id}`,
    kind: "standalone_run",
    title: workflowName,
    url: `https://github.com/foo/bar/actions/runs/${id}`,
    repoFullName: "foo/bar",
    updatedAt: "2026-01-01T12:00:00.000Z",
    unread: false,
    dismissedUntilFingerprint: null,
    run: {
      workflowName,
      event: "push",
      status: "completed",
      conclusion: "success",
      branch: "main",
      sha: "abcd",
      runNumber: id,
      actorLogin: "evan",
      runUrl: `https://github.com/foo/bar/actions/runs/${id}`,
      startedAt: null,
      completedAt: "2026-01-01T12:00:00.000Z",
    },
  };
}

beforeEach(() => {
  useAppStore.getState().reset();
});

describe("RecentlyResolvedSection", () => {
  test("starts collapsed and shows the count badge from the store", () => {
    useAppStore.getState().setPollResult({
      reviewRequests: [],
      inFlight: [],
      standaloneRuns: [],
      recentlyResolved: [mergedPr("foo/bar#1", "Merged PR"), completedRun(7, "CI")],
      rateLimit: null,
      polledAt: "2026-01-02T00:01:00.000Z",
    });
    render(<RecentlyResolvedSection />);
    const section = screen.getByLabelText("Recently Resolved");
    expect(within(section).getByText("2")).toBeInTheDocument();
    // Collapsed by default — the list isn't in the DOM.
    expect(within(section).queryAllByRole("listitem")).toHaveLength(0);
  });

  test("expanding reveals mixed PR + run rows", () => {
    useAppStore.getState().setPollResult({
      reviewRequests: [],
      inFlight: [],
      standaloneRuns: [],
      recentlyResolved: [mergedPr("foo/bar#1", "Merged PR"), completedRun(7, "CI")],
      rateLimit: null,
      polledAt: "2026-01-02T00:01:00.000Z",
    });
    render(<RecentlyResolvedSection />);
    fireEvent.click(screen.getByRole("button", { name: /Recently Resolved/i }));
    const rows = within(screen.getByLabelText("Recently Resolved")).getAllByRole(
      "listitem",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Merged PR");
    expect(rows[1]).toHaveTextContent("CI");
  });
});
