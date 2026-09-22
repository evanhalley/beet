import { describe, expect, test, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "@/lib/store";
import type { ActionableItem } from "@/lib/types";
import { TrayPopover } from "../TrayPopover";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: {
    getByLabel: vi.fn(async () => ({
      show: vi.fn(async () => {}),
      unminimize: vi.fn(async () => {}),
      setFocus: vi.fn(async () => {}),
    })),
  },
}));

function reviewItem(
  n: number,
  overrides: Partial<ActionableItem> = {},
): ActionableItem {
  return {
    id: `pr:org/repo#${n}`,
    kind: "pr",
    title: `PR title ${n}`,
    url: `https://github.com/org/repo/pull/${n}`,
    repoFullName: "org/repo",
    updatedAt: "2026-01-01T00:00:00.000Z",
    unread: true,
    dismissedUntilFingerprint: null,
    pr: {
      number: n,
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
      createdAt: "2026-01-01T00:00:00.000Z",
      lifecycle: "in_review",
      mergeQueue: null,
      taskUrls: [],
      score: 5,
      reviewers: null,
      checkRuns: null,
      associatedRuns: null,
    },
    ...overrides,
  };
}

function inflightItem(n: number): ActionableItem {
  return {
    id: `pr:org/repo#${n}`,
    kind: "pr",
    title: `My PR ${n}`,
    url: `https://github.com/org/repo/pull/${n}`,
    repoFullName: "org/repo",
    updatedAt: "2026-01-01T00:00:00.000Z",
    unread: false,
    dismissedUntilFingerprint: null,
    pr: {
      number: n,
      author: "me",
      body: null,
      isAuthoredByMe: true,
      isReviewRequestedFromMe: false,
      isAuthorOnMyTeam: false,
      iveCommented: false,
      iveReviewed: false,
      iveApproved: false,
      approvalCount: 0,
      isDraft: false,
      additions: 20,
      deletions: 10,
      createdAt: "2026-01-01T00:00:00.000Z",
      lifecycle: "open",
      mergeQueue: null,
      taskUrls: [],
      score: 0,
      reviewers: null,
      checkRuns: null,
      associatedRuns: null,
    },
  };
}

function runItem(id: number): ActionableItem {
  return {
    id: `run:org/repo#${id}`,
    kind: "standalone_run",
    title: "CI Build",
    url: `https://github.com/org/repo/actions/runs/${id}`,
    repoFullName: "org/repo",
    updatedAt: "2026-01-01T00:00:00.000Z",
    unread: false,
    dismissedUntilFingerprint: null,
    run: {
      workflowName: "CI Build",
      event: "push",
      status: "completed",
      conclusion: "success",
      branch: "main",
      sha: "abc1234",
      runNumber: id,
      actorLogin: "me",
      runUrl: `https://github.com/org/repo/actions/runs/${id}`,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z",
    },
  };
}

beforeEach(() => {
  useAppStore.getState().reset();
  window.localStorage.removeItem("beet:tray-collapsed");
});

describe("TrayPopover", () => {
  test("renders all five section headers", () => {
    render(<TrayPopover />);
    expect(screen.getByText("Needs Action")).toBeInTheDocument();
    expect(screen.getByText("Review Requests")).toBeInTheDocument();
    expect(screen.getByText("In Flight")).toBeInTheDocument();
    expect(screen.getByText("Standalone Runs")).toBeInTheDocument();
    expect(screen.getByText("Recently Resolved")).toBeInTheDocument();
  });

  test("Needs Action lists mentioned PRs with their reason badge", () => {
    const mentioned = reviewItem(7);
    mentioned.pr!.activity = { mentionsMe: 1, replyToMyReview: 0 };
    useAppStore.getState().setPollResult({
      reviewRequests: [mentioned, reviewItem(8)],
      inFlight: [inflightItem(9)],
      standaloneRuns: [],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-01-01T00:00:00.000Z",
    });
    render(<TrayPopover />);
    const needsHeader = screen.getByText("Needs Action").closest("button")!;
    expect(needsHeader.textContent).toContain("1");
    expect(screen.getByText("@mention")).toBeInTheDocument();
    expect(screen.queryByText("No items needing action.")).toBeNull();
    // The mentioned PR also stays in Review Requests, but only counts once
    // toward the header badge (2 unread review requests).
    expect(screen.getAllByText("PR title 7")).toHaveLength(2);
  });

  test("renders review request rows with correct count", () => {
    useAppStore.getState().setPollResult({
      reviewRequests: [reviewItem(1), reviewItem(2)],
      inFlight: [],
      standaloneRuns: [],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-01-01T00:00:00.000Z",
    });
    render(<TrayPopover />);
    expect(screen.getByText("PR title 1")).toBeInTheDocument();
    expect(screen.getByText("PR title 2")).toBeInTheDocument();
  });

  test("renders in-flight and standalone run sections", () => {
    useAppStore.getState().setPollResult({
      reviewRequests: [],
      inFlight: [inflightItem(10)],
      standaloneRuns: [runItem(100)],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-01-01T00:00:00.000Z",
    });
    render(<TrayPopover />);
    expect(screen.getByText("My PR 10")).toBeInTheDocument();
    expect(screen.getByText("CI Build")).toBeInTheDocument();
  });

  test("row click calls openInBrowser", async () => {
    const openMod = await import("@/lib/openInBrowser");
    const spy = vi.spyOn(openMod, "openInBrowser").mockResolvedValue();

    useAppStore.getState().setPollResult({
      reviewRequests: [reviewItem(1)],
      inFlight: [],
      standaloneRuns: [],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-01-01T00:00:00.000Z",
    });
    render(<TrayPopover />);
    const row = screen.getByText("PR title 1").closest("[role='button']")!;
    await userEvent.click(row);
    expect(spy).toHaveBeenCalledWith(
      "https://github.com/org/repo/pull/1",
    );
    spy.mockRestore();
  });

  test("rows show the branch name and copying it does not open the browser", async () => {
    const openMod = await import("@/lib/openInBrowser");
    const spy = vi.spyOn(openMod, "openInBrowser").mockResolvedValue();
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const review = reviewItem(1);
    review.pr = { ...review.pr!, headRef: "feat/review-branch" };
    const mine = inflightItem(2);
    mine.pr = { ...mine.pr!, headRef: "feat/my-branch" };
    useAppStore.getState().setPollResult({
      reviewRequests: [review],
      inFlight: [mine],
      standaloneRuns: [runItem(3)],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-01-01T00:00:00.000Z",
    });
    render(<TrayPopover />);

    expect(screen.getByText("feat/review-branch")).toBeInTheDocument();
    expect(screen.getByText("feat/my-branch")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Copy branch name feat/my-branch" }),
    );
    expect(writeText).toHaveBeenCalledWith("feat/my-branch");
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  test("rows without a branch render no copy-branch button", () => {
    useAppStore.getState().setPollResult({
      reviewRequests: [reviewItem(1)],
      inFlight: [],
      standaloneRuns: [],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-01-01T00:00:00.000Z",
    });
    render(<TrayPopover />);
    expect(
      screen.queryByRole("button", { name: /Copy branch name/ }),
    ).toBeNull();
  });

  test("section collapse toggles visibility", async () => {
    useAppStore.getState().setPollResult({
      reviewRequests: [reviewItem(1)],
      inFlight: [],
      standaloneRuns: [],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-01-01T00:00:00.000Z",
    });
    render(<TrayPopover />);
    expect(screen.getByText("PR title 1")).toBeInTheDocument();

    // Collapse the section
    const header = screen.getByText("Review Requests");
    await userEvent.click(header);
    expect(screen.queryByText("PR title 1")).toBeNull();

    // Expand again
    await userEvent.click(header);
    expect(screen.getByText("PR title 1")).toBeInTheDocument();
  });

  test("section collapse state survives a remount (SPECS §11)", async () => {
    useAppStore.getState().setPollResult({
      reviewRequests: [reviewItem(1)],
      inFlight: [],
      standaloneRuns: [],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-01-01T00:00:00.000Z",
    });
    const first = render(<TrayPopover />);
    await userEvent.click(screen.getByText("Review Requests"));
    expect(screen.queryByText("PR title 1")).toBeNull();
    first.unmount();

    render(<TrayPopover />);
    // Still collapsed after the popover window is recreated.
    expect(screen.queryByText("PR title 1")).toBeNull();
  });

  test("corrupt persisted collapse state falls back to defaults", () => {
    window.localStorage.setItem("beet:tray-collapsed", "{not json");
    useAppStore.getState().setPollResult({
      reviewRequests: [reviewItem(1)],
      inFlight: [],
      standaloneRuns: [],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-01-01T00:00:00.000Z",
    });
    render(<TrayPopover />);
    // Defaults: reviews expanded, recent collapsed.
    expect(screen.getByText("PR title 1")).toBeInTheDocument();
  });

  test("shows unread badge count in title bar", () => {
    useAppStore.getState().setPollResult({
      reviewRequests: [
        reviewItem(1, { unread: true }),
        reviewItem(2, { unread: false }),
      ],
      inFlight: [],
      standaloneRuns: [],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-01-01T00:00:00.000Z",
    });
    render(<TrayPopover />);
    // The title bar badge shows the count of unread items
    const titleBar = screen.getByText("Beet").parentElement!;
    expect(within(titleBar).getByText("1")).toBeInTheDocument();
  });

  test("pause toggle invokes set_poll_paused", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    render(<TrayPopover />);
    const pauseBtn = screen.getByLabelText("Pause polling");
    await userEvent.click(pauseBtn);
    expect(invoke).toHaveBeenCalledWith("set_poll_paused", { paused: true });
  });

  test("refresh button invokes refresh_now", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    render(<TrayPopover />);
    const refreshBtn = screen.getByLabelText("Refresh now");
    await userEvent.click(refreshBtn);
    expect(invoke).toHaveBeenCalledWith("refresh_now");
  });
});

describe("TrayPopover code-owner badge", () => {
  test("review rows show 'owner' when I own changed files", () => {
    const owned = reviewItem(1);
    owned.pr!.codeOwnership = { ownedCount: 1, totalCount: 4, hasCodeowners: true, teamsResolved: true };
    const notOwned = reviewItem(2);
    notOwned.pr!.codeOwnership = { ownedCount: 0, totalCount: 4, hasCodeowners: true, teamsResolved: true };
    useAppStore.getState().setPollResult({
      reviewRequests: [owned, notOwned],
      inFlight: [],
      standaloneRuns: [],
      recentlyResolved: [],
      rateLimit: null,
      polledAt: "2026-01-01T00:00:00.000Z",
    });
    render(<TrayPopover />);
    expect(screen.getAllByText("owner")).toHaveLength(1);
  });
});
