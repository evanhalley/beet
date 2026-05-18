import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchPalette } from "./SearchPalette";
import { useAppStore } from "@/lib/store";
import type { ActionableItem } from "@/lib/types";

function makeItem(
  id: string,
  title: string,
  overrides: Partial<ActionableItem> = {},
): ActionableItem {
  return {
    id,
    kind: "pr",
    title,
    url: `https://github.com/acme/repo/pull/${id}`,
    repoFullName: "acme/repo",
    updatedAt: "2026-05-09T10:00:00Z",
    unread: false,
    dismissedUntilFingerprint: null,
    pr: {
      number: Number(id) || 1,
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
      score: 1,
    },
    ...overrides,
  };
}

function seedReviews(items: ActionableItem[]) {
  useAppStore.getState().setPollResult({
    reviewRequests: items,
    inFlight: [],
    rateLimit: null,
    polledAt: "2026-05-09T10:00:00Z",
  });
}

beforeEach(() => {
  useAppStore.getState().reset();
});

describe("SearchPalette", () => {
  test("renders nothing when closed", () => {
    seedReviews([makeItem("1", "Refactor poll loop")]);
    render(<SearchPalette open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("opens with input focused and empty state when no query is typed", () => {
    seedReviews([makeItem("1", "Refactor poll loop")]);
    render(<SearchPalette open onClose={() => {}} />);
    const input = screen.getByLabelText("Search query");
    expect(input).toHaveFocus();
    // Empty query → no listbox rows rendered (no "No matches" either).
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.queryByText("No matches")).toBeNull();
  });

  test("typing filters the corpus", async () => {
    const user = userEvent.setup();
    seedReviews([
      makeItem("1", "Refactor poll loop"),
      makeItem("2", "Add rate-limit cache"),
    ]);
    render(<SearchPalette open onClose={() => {}} />);

    await user.type(screen.getByLabelText("Search query"), "rate");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Add rate-limit cache");
  });

  test("renders empty state for a non-empty query with no matches", async () => {
    const user = userEvent.setup();
    seedReviews([makeItem("1", "Refactor poll loop")]);
    render(<SearchPalette open onClose={() => {}} />);

    await user.type(screen.getByLabelText("Search query"), "zzzz");
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  test("ArrowDown/ArrowUp wrap around the result list", async () => {
    const user = userEvent.setup();
    seedReviews([
      makeItem("1", "alpha"),
      makeItem("2", "alpha two"),
      makeItem("3", "alpha three"),
    ]);
    render(<SearchPalette open onClose={() => {}} />);

    await user.type(screen.getByLabelText("Search query"), "alpha");
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{ArrowDown}{ArrowDown}");
    // Wrapped past the end back to the first row.
    expect(screen.getAllByRole("option")[0]).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{ArrowUp}");
    expect(screen.getAllByRole("option")[2]).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("Enter selects the cursor row and closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    seedReviews([
      makeItem("1", "first"),
      makeItem("2", "first two"),
    ]);
    render(<SearchPalette open onClose={onClose} />);

    await user.type(screen.getByLabelText("Search query"), "first");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(useAppStore.getState().selectedItemId).toBe("2");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Esc closes without changing the selected item", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    seedReviews([makeItem("1", "first")]);
    useAppStore.getState().setSelectedItemId("pre-existing");

    render(<SearchPalette open onClose={onClose} />);
    await user.type(screen.getByLabelText("Search query"), "first");
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().selectedItemId).toBe("pre-existing");
  });

  test("clicking a row selects it and closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    seedReviews([
      makeItem("1", "first"),
      makeItem("2", "first two"),
    ]);
    render(<SearchPalette open onClose={onClose} />);

    await user.type(screen.getByLabelText("Search query"), "first");
    await user.click(screen.getAllByRole("option")[1]);

    expect(useAppStore.getState().selectedItemId).toBe("2");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("clicking the backdrop closes the palette", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    seedReviews([makeItem("1", "first")]);
    render(<SearchPalette open onClose={onClose} />);

    // The backdrop is the presentation wrapper; click outside the dialog card.
    const backdrop = screen.getByRole("presentation");
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
