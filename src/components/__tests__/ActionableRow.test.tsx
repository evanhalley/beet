import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionableRow } from "../ActionableRow";
import { rowActionsReserve } from "../RowShell";
import { useAppStore } from "@/lib/store";
import type { ActionableItem } from "@/lib/types";

function prItem(id: string): ActionableItem {
  return {
    id,
    kind: "pr",
    repoFullName: "acme/repo",
    title: "Fix the flux capacitor",
    url: "https://github.com/acme/repo/pull/42",
    updatedAt: "2026-08-08T00:00:00.000Z",
    unread: false,
    pr: {
      number: 42,
      author: "rina",
      score: 5,
      additions: 10,
      deletions: 2,
      approvalCount: 0,
      isDraft: false,
      isAuthorOnMyTeam: false,
      lifecycle: "open",
      mergeQueue: null,
      taskUrls: [],
    },
    run: null,
  } as unknown as ActionableItem;
}

beforeEach(() => {
  useAppStore.getState().reset();
});

describe("ActionableRow snooze", () => {
  test("snoozing from the context menu records the snooze in the store", async () => {
    const user = userEvent.setup();
    const item = prItem("pr:acme/repo#42");
    render(<ActionableRow item={item} variant="review" />);

    fireEvent.contextMenu(screen.getByRole("button", { name: /select fix the flux/i }));
    await user.click(screen.getByRole("menuitem", { name: /snooze 1 hour/i }));

    await waitFor(() => {
      expect(useAppStore.getState().snoozes[item.id]).toBeTruthy();
    });
    // The stored timestamp is ~1h out.
    const until = Date.parse(useAppStore.getState().snoozes[item.id]);
    expect(until).toBeGreaterThan(Date.now() + 50 * 60 * 1000);
    expect(until).toBeLessThan(Date.now() + 70 * 60 * 1000);
  });

  test("a snoozed row shows the pill and offers Unsnooze, which clears the store", async () => {
    const user = userEvent.setup();
    const item = prItem("pr:acme/repo#43");
    useAppStore
      .getState()
      .setSnoozes({ [item.id]: "2099-01-01T00:00:00.000Z" });
    render(<ActionableRow item={item} variant="review" />);

    expect(screen.getByText("snoozed")).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByRole("button", { name: /select fix the flux/i }));
    await user.click(screen.getByRole("menuitem", { name: /unsnooze/i }));

    await waitFor(() => {
      expect(useAppStore.getState().snoozes[item.id]).toBeUndefined();
    });
  });

  test("the context menu offers the three snooze durations", async () => {
    const item = prItem("pr:acme/repo#44");
    render(<ActionableRow item={item} variant="review" />);

    fireEvent.contextMenu(screen.getByRole("button", { name: /select fix the flux/i }));

    expect(screen.getByRole("menuitem", { name: "Snooze 1 hour" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Snooze 4 hours" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Snooze 1 day" })).toBeInTheDocument();
  });
});

describe("ActionableRow branch", () => {
  test("shows the head branch and copies it without selecting the row", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const item = prItem("pr:acme/repo#45");
    item.pr = { ...item.pr!, headRef: "feat/flux" };
    render(<ActionableRow item={item} variant="review" />);

    expect(screen.getByText("feat/flux")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy branch name feat/flux" }));

    expect(writeText).toHaveBeenCalledWith("feat/flux");
    expect(useAppStore.getState().selectedItemId).not.toBe(item.id);
    Reflect.deleteProperty(navigator, "clipboard");
  });

  test("renders no branch copy button when the branch is unknown", () => {
    render(<ActionableRow item={prItem("pr:acme/repo#46")} variant="inflight" />);
    expect(screen.queryByRole("button", { name: /Copy branch name/ })).toBeNull();
    // The existing copy-link button is still there.
    expect(screen.getByRole("button", { name: /Copy link to/ })).toBeInTheDocument();
  });

  test("a fork PR shows owner:branch and copies gh pr checkout", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const item = prItem("pr:acme/repo#47");
    item.pr = { ...item.pr!, headRef: "main", headForkOwner: "alice" };
    render(<ActionableRow item={item} variant="review" />);

    expect(screen.getByText("alice:main")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Copy checkout command gh pr checkout 42" }),
    );
    expect(writeText).toHaveBeenCalledWith("gh pr checkout 42");
    Reflect.deleteProperty(navigator, "clipboard");
  });

  test("the first line reserves room for the overlaid buttons", () => {
    const item = prItem("pr:acme/repo#48");
    const { rerender } = render(<ActionableRow item={item} variant="review" />);
    const firstLine = () => screen.getByText("acme/repo").parentElement!;
    expect(firstLine()).toHaveStyle({ paddingRight: `${rowActionsReserve(1)}px` });

    item.pr = { ...item.pr!, headRef: "feat/flux" };
    rerender(<ActionableRow item={{ ...item }} variant="review" />);
    expect(firstLine()).toHaveStyle({ paddingRight: `${rowActionsReserve(2)}px` });
  });
});

describe("ActionableRow code-owner badge", () => {
  const owned = { ownedCount: 3, totalCount: 12, hasCodeowners: true, teamsResolved: true };

  test("shows 'owner' on review rows when I own changed files", () => {
    const item = prItem("pr:acme/repo#42");
    item.pr!.codeOwnership = owned;
    render(<ActionableRow item={item} variant="review" />);
    expect(screen.getByText("owner")).toBeInTheDocument();
  });

  test("hides it when nothing is owned or ownership is unknown", () => {
    const none = prItem("pr:acme/repo#42");
    none.pr!.codeOwnership = { ...owned, ownedCount: 0 };
    const { unmount } = render(<ActionableRow item={none} variant="review" />);
    expect(screen.queryByText("owner")).not.toBeInTheDocument();
    unmount();
    render(<ActionableRow item={prItem("pr:acme/repo#43")} variant="review" />);
    expect(screen.queryByText("owner")).not.toBeInTheDocument();
  });
});
