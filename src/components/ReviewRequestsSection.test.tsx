import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewRequestsSection } from "./ReviewRequestsSection";
import { useAppStore } from "@/lib/store";
import type { ActionableItem } from "@/lib/types";

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(async () => {}),
}));

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
      isAuthoredByMe: false,
      isReviewRequestedFromMe: true,
      isAuthorOnMyTeam: false,
      iveCommented: false,
      iveReviewed: false,
      iveApproved: false,
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

beforeEach(() => {
  useAppStore.getState().reset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ReviewRequestsSection", () => {
  test("renders rows sorted by score desc", () => {
    render(
      <ReviewRequestsSection
        items={[makeItem("a", 3), makeItem("b", 9), makeItem("c", 5)]}
      />,
    );
    const buttons = screen.getAllByRole("button", { name: /open .* on github/i });
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Open Title b on GitHub",
      "Open Title c on GitHub",
      "Open Title a on GitHub",
    ]);
  });

  test("renders empty state when no items", () => {
    render(<ReviewRequestsSection items={[]} />);
    expect(screen.getByText(/no review requests right now/i)).toBeInTheDocument();
  });

  test("Show all toggle flips store state", async () => {
    const user = userEvent.setup();
    render(<ReviewRequestsSection items={[makeItem("a", 6)]} />);
    expect(useAppStore.getState().showAllReviews).toBe(false);
    const toggle = screen.getByLabelText(/show all review requests/i);
    await user.click(toggle);
    expect(useAppStore.getState().showAllReviews).toBe(true);
  });

  test("clicking a row invokes tauri shell open", async () => {
    const user = userEvent.setup();
    const shellMod = (await import("@tauri-apps/plugin-shell")) as unknown as {
      open: ReturnType<typeof vi.fn>;
    };
    render(<ReviewRequestsSection items={[makeItem("a", 7)]} />);
    await user.click(
      screen.getByRole("button", { name: "Open Title a on GitHub" }),
    );
    expect(shellMod.open).toHaveBeenCalledWith(
      "https://github.com/acme/repo/pull/a",
    );
  });

  test("collapse hides the list", async () => {
    const user = userEvent.setup();
    render(<ReviewRequestsSection items={[makeItem("a", 7)]} />);
    const header = screen.getByRole("button", { name: /review requests/i });
    expect(screen.getByRole("button", { name: /open title a/i })).toBeInTheDocument();
    await user.click(header);
    expect(screen.queryByRole("button", { name: /open title a/i })).toBeNull();
  });

  test("task chips render when present", () => {
    render(
      <ReviewRequestsSection
        items={[
          makeItem("a", 6, {
            taskUrls: [
              "https://your-company.atlassian.net/browse/PROJ-1",
              "https://your-company.atlassian.net/browse/PROJ-2",
            ],
          }),
        ]}
      />,
    );
    const row = screen.getByRole("button", { name: /open title a/i });
    expect(within(row).getByText("PROJ-1")).toBeInTheDocument();
    expect(within(row).getByText("PROJ-2")).toBeInTheDocument();
  });
});
