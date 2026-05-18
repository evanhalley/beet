import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MainWindowShell } from "./MainWindowShell";
import { useAppStore } from "@/lib/store";
import type { ActionableItem } from "@/lib/types";

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(async () => {}),
}));

// Server state lives in the store (fed by the Rust poll loop in prod);
// useActionableItems / useSelectedItem select off it. Seed via setPollResult,
// preserving whichever section we're not currently setting.
function seedReviews(items: ActionableItem[]) {
  const { inFlight } = useAppStore.getState();
  useAppStore.getState().setPollResult({
    reviewRequests: items,
    inFlight,
    rateLimit: null,
    polledAt: "2026-05-09T10:00:00.000Z",
  });
}

function seedInFlight(items: ActionableItem[]) {
  const { reviewRequests } = useAppStore.getState();
  useAppStore.getState().setPollResult({
    reviewRequests,
    inFlight: items,
    rateLimit: null,
    polledAt: "2026-05-09T10:00:00.000Z",
  });
}

function makeItem(id: string, score: number, title?: string): ActionableItem {
  return {
    id,
    kind: "pr",
    title: title ?? `Title ${id}`,
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
      additions: 10,
      deletions: 5,
      createdAt: "2026-05-08T10:00:00Z",
      lifecycle: "in_review",
      taskUrls: [],
      score,
    },
  };
}

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MainWindowShell onOpenSettings={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAppStore.getState().reset();
  seedReviews([]);
  seedInFlight([]);
});

describe("MainWindowShell", () => {
  test("auto-selects the top-scored review request when nothing is selected", () => {
    seedReviews([
      makeItem("a", 3, "Low scorer"),
      makeItem("b", 9, "High scorer"),
      makeItem("c", 5, "Mid scorer"),
    ]);
    renderShell();
    expect(
      screen.getByRole("button", { name: "Open High scorer on GitHub" }),
    ).toBeInTheDocument();
  });

  test("renders 'Select an item.' when there are no items", () => {
    renderShell();
    expect(screen.getByText("Select an item.")).toBeInTheDocument();
  });

  test("clicking a row updates the detail pane to that item", async () => {
    const user = userEvent.setup();
    seedReviews([makeItem("a", 8, "First"), makeItem("b", 4, "Second")]);
    renderShell();
    expect(
      screen.getByRole("button", { name: "Open First on GitHub" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Select Second" }));
    expect(useAppStore.getState().selectedItemId).toBe("b");
    expect(
      screen.getByRole("button", { name: "Open Second on GitHub" }),
    ).toBeInTheDocument();
  });

  test("auto-pick is mirrored back into the store so the row highlights", async () => {
    seedReviews([makeItem("a", 4, "Low"), makeItem("b", 9, "High")]);
    renderShell();
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().selectedItemId).toBe("b");
  });

  test("stored selection that no longer resolves repairs to the auto-pick", async () => {
    seedReviews([makeItem("a", 7, "Only")]);
    useAppStore.getState().setSelectedItemId("ghost");
    renderShell();
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().selectedItemId).toBe("a");
  });

  test("Open on GitHub button invokes tauri shell open", async () => {
    const user = userEvent.setup();
    const shellMod = (await import("@tauri-apps/plugin-shell")) as unknown as {
      open: ReturnType<typeof vi.fn>;
    };
    seedReviews([makeItem("a", 7, "Only")]);
    renderShell();
    await user.click(screen.getByRole("button", { name: "Open Only on GitHub" }));
    expect(shellMod.open).toHaveBeenCalledWith(
      "https://github.com/acme/repo/pull/a",
    );
  });

  test("⌘K toggles the search palette open and closed", () => {
    seedReviews([makeItem("a", 7, "Only")]);
    renderShell();
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(
      screen.getByRole("dialog", { name: "Search" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
  });

  test("⌘K is suppressed while focus is in an unrelated input", () => {
    seedReviews([makeItem("a", 7, "Only")]);
    renderShell();

    const stray = document.createElement("input");
    document.body.appendChild(stray);
    stray.focus();
    expect(document.activeElement).toBe(stray);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();

    document.body.removeChild(stray);
  });
});
