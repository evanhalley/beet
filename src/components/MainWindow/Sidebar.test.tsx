import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { useActionableItems } from "@/hooks/useActionableItems";
import { useAppStore } from "@/lib/store";
import type { ActionableItem } from "@/lib/types";

vi.mock("@/hooks/useActionableItems", () => ({
  useActionableItems: vi.fn(),
}));

function setActionable(
  reviewRequests: ActionableItem[],
  inFlight: ActionableItem[] = [],
) {
  const byId = new Map<string, ActionableItem>();
  for (const it of [...reviewRequests, ...inFlight]) byId.set(it.id, it);
  vi.mocked(useActionableItems).mockReturnValue({
    reviewRequests,
    inFlight,
    standaloneRuns: [],
    recentlyResolved: [],
    byId,
    isLoading: false,
    isFetching: false,
  });
}

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
      score: 5,
    },
  };
}

beforeEach(() => {
  useAppStore.getState().reset();
  setActionable([], []);
});

describe("Sidebar", () => {
  test("Triage counts reflect the actionable-items hook", () => {
    setActionable([prItem("a"), prItem("b"), prItem("c")], []);
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

  test("Review Requests and In Flight are both clickable; the active one is aria-current=page", () => {
    render(<Sidebar />);
    // Default activeSection is "reviews".
    const reviews = screen.getByRole("button", { name: /Review Requests/ });
    expect(reviews).not.toBeDisabled();
    expect(reviews.getAttribute("aria-current")).toBe("page");

    const inflight = screen.getByRole("button", { name: /In Flight/ });
    expect(inflight).not.toBeDisabled();
    expect(inflight.getAttribute("aria-current")).toBeNull();
  });

  test("clicking a Triage section fires onSectionClick", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    const onSectionClick = vi.fn();
    render(<Sidebar onSectionClick={onSectionClick} />);
    await user.click(screen.getByRole("button", { name: /In Flight/ }));
    expect(onSectionClick).toHaveBeenCalledWith("inflight");
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
