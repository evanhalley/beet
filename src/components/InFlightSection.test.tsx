import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InFlightSection } from "./InFlightSection";
import { useAppStore } from "@/lib/store";
import type { ActionableItem, PrLifecycle } from "@/lib/types";

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(async () => {}),
}));

interface MakeItemOpts {
  id: string;
  updatedAt: string;
  lifecycle?: PrLifecycle;
  mergeQueue?: ActionableItem["pr"] extends infer P
    ? P extends { mergeQueue?: infer M }
      ? M
      : never
    : never;
}

function makeItem({
  id,
  updatedAt,
  lifecycle = "open",
  mergeQueue,
}: MakeItemOpts): ActionableItem {
  return {
    id,
    kind: "pr",
    title: `Title ${id}`,
    url: `https://github.com/acme/repo/pull/${id}`,
    repoFullName: "acme/repo",
    updatedAt,
    unread: false,
    dismissedUntilFingerprint: null,
    pr: {
      number: 1,
      author: "octocat",
      body: null,
      isAuthoredByMe: true,
      isReviewRequestedFromMe: false,
      isAuthorOnMyTeam: false,
      iveCommented: false,
      iveReviewed: false,
      iveApproved: false,
      approvalCount: 0,
      isDraft: false,
      additions: 10,
      deletions: 5,
      createdAt: "2026-05-08T10:00:00Z",
      lifecycle,
      mergeQueue,
      taskUrls: [],
      score: 0,
    },
  };
}

// InFlightSection reads from the store (fed by the Rust poll loop in prod);
// tests push items straight in via setPollResult.
function seed(items: ActionableItem[]) {
  useAppStore.getState().setPollResult({
    reviewRequests: [],
    inFlight: items,
    rateLimit: null,
    polledAt: "2026-05-12T00:00:00.000Z",
  });
}

beforeEach(() => {
  useAppStore.getState().reset();
  seed([]);
});

describe("InFlightSection", () => {
  test("rows sorted by updatedAt desc (not score)", () => {
    seed([
      makeItem({ id: "older", updatedAt: "2026-05-01T00:00:00Z" }),
      makeItem({ id: "newest", updatedAt: "2026-05-12T00:00:00Z" }),
      makeItem({ id: "middle", updatedAt: "2026-05-09T00:00:00Z" }),
    ]);
    render(<InFlightSection />);
    const buttons = screen.getAllByRole("button", { name: /^select title /i });
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Select Title newest",
      "Select Title middle",
      "Select Title older",
    ]);
  });

  test("renders the Lifecycle pill, including queue · ? for merge_queue", () => {
    seed([
      makeItem({
        id: "queued",
        updatedAt: "2026-05-12T00:00:00Z",
        lifecycle: "merge_queue",
        mergeQueue: { position: null, enteredAt: "2026-05-12T00:00:00Z" },
      }),
    ]);
    render(<InFlightSection />);
    expect(screen.getByText(/queue · \?/)).toBeInTheDocument();
  });

  test("renders the Kicked-from-queue badge when ejectedChecks is set", () => {
    seed([
      makeItem({
        id: "ejected",
        updatedAt: "2026-05-12T00:00:00Z",
        lifecycle: "open",
        mergeQueue: {
          position: null,
          enteredAt: "2026-05-11T00:00:00Z",
          lastEjectionAt: "2026-05-12T00:00:00Z",
          ejectedChecks: [{ name: "ci/integration", conclusion: "failure" }],
        },
      }),
    ]);
    render(<InFlightSection />);
    expect(screen.getByText("Kicked from queue")).toBeInTheDocument();
  });

  test("does not render the ScoreBar (review-request-only)", () => {
    seed([makeItem({ id: "a", updatedAt: "2026-05-12T00:00:00Z" })]);
    render(<InFlightSection />);
    expect(screen.queryByLabelText(/score/i)).not.toBeInTheDocument();
  });

  test("renders the approvals pill when approvalCount > 0", () => {
    const base = makeItem({ id: "a", updatedAt: "2026-05-12T00:00:00Z" });
    base.pr!.approvalCount = 2;
    seed([base]);
    render(<InFlightSection />);
    expect(screen.getByText(/2 approved/)).toBeInTheDocument();
  });

  test("hides the approvals pill when approvalCount is 0", () => {
    seed([makeItem({ id: "a", updatedAt: "2026-05-12T00:00:00Z" })]);
    render(<InFlightSection />);
    expect(screen.queryByText(/approved/)).not.toBeInTheDocument();
  });

  test("renders the AlertTriangle warning on ejected rows", () => {
    seed([
      makeItem({
        id: "ej",
        updatedAt: "2026-05-12T00:00:00Z",
        lifecycle: "open",
        mergeQueue: {
          position: null,
          enteredAt: "2026-05-11T00:00:00Z",
          lastEjectionAt: "2026-05-12T00:00:00Z",
          ejectedChecks: [{ name: "ci/integration", conclusion: "failure" }],
        },
      }),
    ]);
    render(<InFlightSection />);
    expect(screen.getByLabelText("Kicked from queue")).toBeInTheDocument();
  });

  test("empty state when no items", () => {
    render(<InFlightSection />);
    expect(screen.getByText(/no prs in flight right now/i)).toBeInTheDocument();
  });

  test("copy-link button writes the PR URL to the clipboard without selecting the row", async () => {
    // userEvent.setup() installs its own navigator.clipboard stub, so define
    // ours afterwards to make sure it's the one the helper hits.
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    seed([makeItem({ id: "412", updatedAt: "2026-05-12T00:00:00Z" })]);
    render(<InFlightSection />);

    await user.click(
      screen.getByRole("button", { name: "Copy link to Title 412" }),
    );

    expect(writeText).toHaveBeenCalledWith(
      "https://github.com/acme/repo/pull/412",
    );
    // Clicking copy must not bubble to the row's select handler.
    expect(useAppStore.getState().selectedItemId).toBeNull();
  });
});
