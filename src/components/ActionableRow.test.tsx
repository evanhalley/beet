import { beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionableRow } from "./ActionableRow";
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
