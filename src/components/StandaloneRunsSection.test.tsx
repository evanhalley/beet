import { describe, expect, test, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { useAppStore } from "@/lib/store";
import type { ActionableItem } from "@/lib/types";
import { StandaloneRunsSection } from "./StandaloneRunsSection";

function runItem(id: number, workflowName: string, updatedAt: string): ActionableItem {
  return {
    id: `run:foo/bar#${id}`,
    kind: "standalone_run",
    title: workflowName,
    url: `https://github.com/foo/bar/actions/runs/${id}`,
    repoFullName: "foo/bar",
    updatedAt,
    unread: true,
    dismissedUntilFingerprint: null,
    run: {
      workflowName,
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      branch: "main",
      sha: "deadbeefcafe",
      runNumber: id,
      actorLogin: "evan",
      runUrl: `https://github.com/foo/bar/actions/runs/${id}`,
      startedAt: updatedAt,
      completedAt: updatedAt,
    },
  };
}

beforeEach(() => {
  useAppStore.getState().reset();
});

describe("StandaloneRunsSection", () => {
  test("renders the empty-state line when no runs are present", () => {
    render(<StandaloneRunsSection />);
    expect(screen.getByText(/no standalone workflow runs/i)).toBeInTheDocument();
  });

  test("renders a relative timestamp on each row with the ISO time as a tooltip", () => {
    const updated = "2026-01-01T00:00:00.000Z";
    useAppStore.getState().setPollResult({
      reviewRequests: [],
      inFlight: [],
      standaloneRuns: [runItem(1, "Deploy", updated)],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-01-01T00:01:00.000Z",
    });
    render(<StandaloneRunsSection />);
    const section = screen.getByLabelText("Standalone Runs");
    // The relative time label carries the raw ISO timestamp as title/aria.
    const stamp = within(section).getByLabelText(`Updated ${updated}`);
    expect(stamp).toHaveAttribute("title", updated);
    // dayjs.fromNow output for years-in-the-past inputs is non-empty.
    expect(stamp.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  test("sorts runs newest-first by updatedAt and shows the count badge", () => {
    useAppStore.getState().setPollResult({
      reviewRequests: [],
      inFlight: [],
      standaloneRuns: [
        runItem(1, "Older", "2026-01-01T00:00:00.000Z"),
        runItem(2, "Newer", "2026-01-02T00:00:00.000Z"),
      ],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-01-02T00:01:00.000Z",
    });
    render(<StandaloneRunsSection />);
    const section = screen.getByLabelText("Standalone Runs");
    // The badge in the section header reads `2`.
    expect(within(section).getByText("2")).toBeInTheDocument();
    const rows = within(section).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Newer");
    expect(rows[1]).toHaveTextContent("Older");
  });
});
