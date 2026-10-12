import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MainWindowShell } from "../MainWindowShell";
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

  test("auto-selects the top Needs Action item ahead of review requests", () => {
    const mentioned = makeItem("m", 3, "Mentioned me");
    mentioned.pr!.activity = { mentionsMe: 1, replyToMyReview: 0 };
    seedReviews([makeItem("b", 9, "High scorer"), mentioned]);
    renderShell();
    expect(
      screen.getByRole("button", { name: "Open Mentioned me on GitHub" }),
    ).toBeInTheDocument();
  });

  test("renders 'Select an item.' when there are no items", () => {
    // After a completed poll cycle returned nothing — distinct from cold
    // start, which renders a Loading indicator instead.
    useAppStore.setState({ pollState: "ok" });
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

  test("pending notification selection wins over auto-pick and is cleared", async () => {
    // "b" is the top scorer auto-pick would choose; the notification points at
    // the lower-scored "a", which must win.
    seedReviews([makeItem("a", 4, "Low"), makeItem("b", 9, "High")]);
    useAppStore.getState().setPendingNotificationItemId("a");
    renderShell();
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().selectedItemId).toBe("a");
    expect(useAppStore.getState().pendingNotificationItemId).toBeNull();
  });

  test("pending selection waits for the item to load, suppressing auto-pick", async () => {
    // Cold-start race: the click arrives before the first poll has completed
    // (pollState still "idle"), so the target isn't in the data yet.
    seedReviews([makeItem("b", 9, "High")]);
    useAppStore.getState().setPendingNotificationItemId("a");
    renderShell();
    await new Promise((r) => setTimeout(r, 0));
    // Auto-pick is held off; nothing resolves yet, and pending is preserved
    // because no poll has completed that could prove the item is gone.
    expect(useAppStore.getState().selectedItemId).toBeNull();
    expect(useAppStore.getState().pendingNotificationItemId).toBe("a");

    // The first poll completes and carries the target → it's selected and
    // pending clears.
    useAppStore.setState({ pollState: "ok" });
    seedReviews([makeItem("a", 4, "Low"), makeItem("b", 9, "High")]);
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().selectedItemId).toBe("a");
    expect(useAppStore.getState().pendingNotificationItemId).toBeNull();
  });

  test("pending selection is abandoned once a poll completes without the target", async () => {
    // The notification points at an item that's no longer tracked (merged,
    // untracked, or aged out). After a poll cycle finishes and it's still
    // absent, the pending marker must clear so auto-pick can resume instead of
    // the app sitting stuck with an empty detail pane forever.
    useAppStore.setState({ pollState: "ok" });
    seedReviews([makeItem("b", 9, "High")]);
    useAppStore.getState().setPendingNotificationItemId("gone");
    renderShell();
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().pendingNotificationItemId).toBeNull();
    // Auto-pick resumes and selects the top-scored review request.
    expect(useAppStore.getState().selectedItemId).toBe("b");
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

describe("MainWindowShell detail-pane resizing", () => {
  // jsdom has no layout: report a fixed grid box for every element, mutable
  // per test to simulate window resizes.
  let gridWidth = 1400;
  const GRID_RIGHT = 1600;

  // jsdom has no PointerEvent, so fireEvent.pointer* would drop clientX and
  // button. Stand one in for this block only.
  const hadPointerEvent = "PointerEvent" in window;
  beforeAll(() => {
    if (hadPointerEvent) return;
    class PointerEventShim extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    }
    Object.defineProperty(window, "PointerEvent", {
      value: PointerEventShim,
      configurable: true,
      writable: true,
    });
  });
  afterAll(() => {
    if (!hadPointerEvent) delete (window as { PointerEvent?: unknown }).PointerEvent;
  });

  beforeEach(() => {
    gridWidth = 1400;
    window.localStorage.clear();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          width: gridWidth,
          right: GRID_RIGHT,
          left: GRID_RIGHT - gridWidth,
          top: 0,
          bottom: 800,
          height: 800,
          x: GRID_RIGHT - gridWidth,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    return () => vi.restoreAllMocks();
  });

  const splitter = () => screen.getByRole("separator", { name: "Resize detail pane" });
  const width = () => Number(splitter().getAttribute("aria-valuenow"));

  test("dragging can widen the detail pane past the old 720px cap", () => {
    renderShell();
    fireEvent.pointerDown(splitter(), { button: 0, pointerId: 1 });
    fireEvent.pointerMove(splitter(), { clientX: GRID_RIGHT - 1000, pointerId: 1 });
    fireEvent.pointerUp(splitter(), { pointerId: 1 });
    expect(width()).toBe(1000);
    expect(window.localStorage.getItem("beet.detailWidth")).toBe("1000");
  });

  test("the list pane keeps its minimum width", () => {
    renderShell();
    fireEvent.pointerDown(splitter(), { button: 0, pointerId: 1 });
    fireEvent.pointerMove(splitter(), { clientX: 0, pointerId: 1 });
    fireEvent.pointerUp(splitter(), { pointerId: 1 });
    // 1400 grid − 320 list floor − 1 splitter
    expect(width()).toBe(1079);
    expect(splitter()).toHaveAttribute("aria-valuemax", "1079");
  });

  test("moving the pointer without pressing does nothing", () => {
    renderShell();
    fireEvent.pointerMove(splitter(), { clientX: 100, pointerId: 1 });
    expect(width()).toBe(380);
  });

  test("shrinking the window narrows the pane; growing it restores the preference", () => {
    window.localStorage.setItem("beet.detailWidth", "1000");
    renderShell();
    expect(width()).toBe(1000);

    gridWidth = 900;
    fireEvent(window, new Event("resize"));
    expect(width()).toBe(579);

    gridWidth = 1400;
    fireEvent(window, new Event("resize"));
    expect(width()).toBe(1000);
  });

  test("keyboard: arrows nudge, Home/End jump, double-click resets", () => {
    renderShell();
    const sep = splitter();
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(width()).toBe(396);
    fireEvent.keyDown(sep, { key: "ArrowLeft", shiftKey: true });
    expect(width()).toBe(460);
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(width()).toBe(444);
    fireEvent.keyDown(sep, { key: "End" });
    expect(width()).toBe(1079);
    fireEvent.keyDown(sep, { key: "Home" });
    expect(width()).toBe(280);
    fireEvent.doubleClick(sep);
    expect(width()).toBe(380);
  });
});
