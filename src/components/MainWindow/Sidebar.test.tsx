import { beforeEach, describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { useAppStore } from "@/lib/store";
import type { ActionableItem } from "@/lib/types";

function prItem(id: string): ActionableItem {
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
      isAuthoredByMe: false,
      isReviewRequestedFromMe: true,
      isAuthorOnMyTeam: false,
      iveCommented: false,
      iveReviewed: false,
      iveApproved: false,
      isDraft: false,
      additions: 0,
      deletions: 0,
      createdAt: "2026-05-08T10:00:00Z",
      lifecycle: "in_review",
      taskUrls: [],
      score: 5,
    },
  };
}

beforeEach(() => {
  useAppStore.getState().reset();
});

describe("Sidebar", () => {
  test("Triage counts reflect store arrays", () => {
    useAppStore.setState({
      reviewRequests: [prItem("a"), prItem("b"), prItem("c")],
      inFlight: [],
      standaloneRuns: [],
    });
    render(<Sidebar />);
    const reviews = screen.getByRole("button", { name: /Review Requests/ });
    expect(reviews.textContent).toContain("3");

    const inflight = screen.getByRole("button", { name: /In Flight/ });
    expect(inflight.textContent).toContain("0");

    const runs = screen.getByRole("button", { name: /Standalone Runs/ });
    expect(runs.textContent).toContain("0");
  });

  test("rate-limit card reads from store.rateLimit", () => {
    useAppStore.setState({
      rateLimit: {
        remaining: 4200,
        limit: 5000,
        reset: Math.floor(Date.now() / 1000) + 300,
      },
    });
    render(<Sidebar />);
    expect(screen.getByText("4200/5000")).toBeInTheDocument();
    expect(screen.getByText(/resets in/i)).toBeInTheDocument();
  });

  test("rate-limit card shows em-dash placeholder when nothing has been observed", () => {
    render(<Sidebar />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  test("inactive Triage items are disabled; the active one is aria-current=page", () => {
    render(<Sidebar />);
    // Default activeSection is "reviews".
    const reviews = screen.getByRole("button", { name: /Review Requests/ });
    expect(reviews).not.toBeDisabled();
    expect(reviews.getAttribute("aria-current")).toBe("page");

    const inflight = screen.getByRole("button", { name: /In Flight/ });
    expect(inflight).toBeDisabled();
    expect(inflight.getAttribute("aria-current")).toBeNull();
  });

  test("Filters / Pinned / Muted groups render but their rows are disabled", () => {
    render(<Sidebar />);
    const failing = screen.getByRole("button", { name: /Failing only/ });
    expect(failing).toBeDisabled();
    const pending = screen.getByRole("button", { name: /Pending only/ });
    expect(pending).toBeDisabled();
    const myteam = screen.getByRole("button", { name: /My team only/ });
    expect(myteam).toBeDisabled();
    expect(screen.getByRole("button", { name: /No pinned repos/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /No muted repos/ })).toBeDisabled();
  });
});
