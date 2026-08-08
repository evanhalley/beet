import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewRequestsSection } from "../ReviewRequestsSection";
import { useAppStore } from "@/lib/store";
import { SETTINGS_DEFAULTS } from "@/lib/storage/settings";
import type { ActionableItem } from "@/lib/types";

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(async () => {}),
}));

// The Suppress context-menu action persists via these; stub them so tests
// exercise the store wiring without a Tauri backend.
vi.mock("@/lib/storage/suppress", () => ({
  addSuppression: vi.fn(async () => {}),
  removeSuppression: vi.fn(async () => {}),
}));

// ReviewRequestsSection reads from the store (fed by the Rust poll loop in
// prod); tests push items straight in via setPollResult.
function setItems(items: ActionableItem[]) {
  useAppStore.getState().setPollResult({
    reviewRequests: items,
    inFlight: [],
    rateLimit: null,
    polledAt: "2026-05-09T10:00:00.000Z",
  });
}

function makeItem(
  id: string,
  score: number,
  overrides: Partial<ActionableItem["pr"]> = {},
): ActionableItem {
  return {
    id,
    kind: "pr",
    title: `Title ${id}`,
    url: `https://github.com/acme/repo/pull/${id}`,
    repoFullName: "acme/repo",
    updatedAt: "2026-05-09T10:00:00Z",
    unread: true,
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
      additions: 10,
      deletions: 5,
      createdAt: "2026-05-08T10:00:00Z",
      lifecycle: "in_review",
      taskUrls: [],
      score,
      ...overrides,
    },
  };
}

function seedItems(items: ActionableItem[]) {
  setItems(items);
}

beforeEach(() => {
  useAppStore.getState().reset();
  setItems([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ReviewRequestsSection", () => {
  test("renders rows sorted by score desc", () => {
    seedItems([makeItem("a", 3), makeItem("b", 9), makeItem("c", 5)]);
    render(<ReviewRequestsSection />);
    const buttons = screen.getAllByRole("button", { name: /^select title /i });
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Select Title b",
      "Select Title c",
      "Select Title a",
    ]);
  });

  test("renders empty state when no items", () => {
    // Cold-start renders skeleton rows; empty-state copy is for the
    // "we polled, nothing came back" case.
    useAppStore.setState({ pollState: "ok" });
    render(<ReviewRequestsSection />);
    expect(screen.getByText(/no review requests right now/i)).toBeInTheDocument();
  });

  test("renders skeleton rows during cold start", () => {
    render(<ReviewRequestsSection />);
    expect(screen.queryByText(/no review requests right now/i)).toBeNull();
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
  });

  test("rows have aria-pressed reflecting selection", () => {
    seedItems([makeItem("a", 6), makeItem("b", 5)]);
    useAppStore.setState({ selectedItemId: "a" });
    render(<ReviewRequestsSection />);
    const a = screen.getByRole("button", { name: "Select Title a" });
    const b = screen.getByRole("button", { name: "Select Title b" });
    expect(a.getAttribute("aria-pressed")).toBe("true");
    expect(b.getAttribute("aria-pressed")).toBe("false");
  });

  test("Show all toggle writes to override slice (not the global setting)", async () => {
    const user = userEvent.setup();
    seedItems([makeItem("a", 6)]);
    expect(useAppStore.getState().showAllReviewsOverride).toBeNull();
    expect(useAppStore.getState().settings.showAllApproved).toBe(false);

    render(<ReviewRequestsSection />);
    await user.click(screen.getByLabelText(/show all review requests/i));

    expect(useAppStore.getState().showAllReviewsOverride).toBe(true);
    // Global is untouched.
    expect(useAppStore.getState().settings.showAllApproved).toBe(false);
  });

  test("override resolves over the global default", () => {
    seedItems([makeItem("a", 6)]);
    useAppStore.setState({
      settings: { ...SETTINGS_DEFAULTS, showAllApproved: true },
      showAllReviewsOverride: false,
    });
    render(<ReviewRequestsSection />);
    const toggle = screen.getByLabelText(
      /show all review requests/i,
    ) as HTMLInputElement;
    // override (false) wins despite global being true
    expect(toggle.checked).toBe(false);
  });

  test("'use default' link is hidden when override is null and clears it when clicked", async () => {
    const user = userEvent.setup();
    seedItems([makeItem("a", 6)]);
    render(<ReviewRequestsSection />);

    expect(screen.queryByRole("button", { name: /reset show all/i })).toBeNull();

    await user.click(screen.getByLabelText(/show all review requests/i));
    expect(useAppStore.getState().showAllReviewsOverride).toBe(true);

    await user.click(screen.getByRole("button", { name: /reset show all/i }));
    expect(useAppStore.getState().showAllReviewsOverride).toBeNull();
  });

  test("clicking a row sets selectedItemId (does not open browser)", async () => {
    const user = userEvent.setup();
    const shellMod = (await import("@tauri-apps/plugin-shell")) as unknown as {
      open: ReturnType<typeof vi.fn>;
    };
    seedItems([makeItem("a", 7)]);
    render(<ReviewRequestsSection />);
    expect(useAppStore.getState().selectedItemId).toBeNull();
    await user.click(screen.getByRole("button", { name: "Select Title a" }));
    expect(useAppStore.getState().selectedItemId).toBe("a");
    expect(shellMod.open).not.toHaveBeenCalled();
  });

  test("collapse hides the list", async () => {
    const user = userEvent.setup();
    seedItems([makeItem("a", 7)]);
    render(<ReviewRequestsSection />);
    const header = screen.getByRole("button", { name: /review requests/i });
    expect(screen.getByRole("button", { name: /select title a/i })).toBeInTheDocument();
    await user.click(header);
    expect(screen.queryByRole("button", { name: /select title a/i })).toBeNull();
  });

  test("task chips render when present", () => {
    seedItems([
      makeItem("a", 6, {
        taskUrls: [
          "https://your-company.atlassian.net/browse/PROJ-1",
          "https://your-company.atlassian.net/browse/PROJ-2",
        ],
      }),
    ]);
    render(<ReviewRequestsSection />);
    const row = screen.getByRole("button", { name: /select title a/i });
    expect(within(row).getByText("PROJ-1")).toBeInTheDocument();
    expect(within(row).getByText("PROJ-2")).toBeInTheDocument();
  });

  test("rows are exposed as a list for screen readers", () => {
    seedItems([makeItem("a", 6), makeItem("b", 5)]);
    render(<ReviewRequestsSection />);
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  test("right-click → Suppress this PR persists and drops the row from the default list", async () => {
    const user = userEvent.setup();
    const suppressMod = (await import("@/lib/storage/suppress")) as unknown as {
      addSuppression: ReturnType<typeof vi.fn>;
    };
    seedItems([makeItem("pr:acme/repo#1", 8)]);
    render(<ReviewRequestsSection />);

    const row = screen.getByRole("button", {
      name: "Select Title pr:acme/repo#1",
    });
    fireEvent.contextMenu(row);
    await user.click(screen.getByRole("menuitem", { name: /suppress this pr/i }));

    expect(suppressMod.addSuppression).toHaveBeenCalledWith("pr:acme/repo#1");
    expect(useAppStore.getState().suppressedIds).toContain("pr:acme/repo#1");
    // Show-All is off by default → the suppressed row is gone.
    expect(
      screen.queryByRole("button", { name: "Select Title pr:acme/repo#1" }),
    ).toBeNull();
  });

  test("a suppressed PR reappears (marked) when Show all is on and offers Unsuppress", async () => {
    seedItems([makeItem("pr:acme/repo#1", 8)]);
    useAppStore.setState({
      suppressedIds: ["pr:acme/repo#1"],
      showAllReviewsOverride: true,
    });
    render(<ReviewRequestsSection />);

    const row = screen.getByRole("button", {
      name: "Select Title pr:acme/repo#1",
    });
    expect(within(row).getByText(/suppressed/i)).toBeInTheDocument();

    fireEvent.contextMenu(row);
    expect(
      screen.getByRole("menuitem", { name: /unsuppress this pr/i }),
    ).toBeInTheDocument();
  });
});
