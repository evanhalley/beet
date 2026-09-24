import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NeedsActionSection } from "../NeedsActionSection";
import { useAppStore } from "@/lib/store";
import type { ActionableItem, ActionableItemPr } from "@/lib/types";

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(async () => {}),
}));

function prItem(
  id: string,
  pr: Partial<ActionableItemPr> = {},
  updatedAt = "2026-05-12T00:00:00Z",
): ActionableItem {
  return {
    id,
    kind: "pr",
    title: `Title ${id}`,
    url: `https://github.com/acme/repo/pull/${id}`,
    repoFullName: "acme/repo",
    updatedAt,
    unread: true,
    dismissedUntilFingerprint: null,
    pr: {
      number: 1,
      author: "octocat",
      body: null,
      isAuthoredByMe: false,
      isReviewRequestedFromMe: true,
      isAuthorOnMyTeam: false,
      iveCommented: false,
      iveReviewed: false,
      iveApproved: false,
      approvalCount: 0,
      isDraft: false,
      additions: 1,
      deletions: 1,
      createdAt: "2026-05-08T10:00:00Z",
      lifecycle: "in_review",
      taskUrls: [],
      score: 3,
      ...pr,
    },
  };
}

const mine = (id: string, pr: Partial<ActionableItemPr>, updatedAt?: string) =>
  prItem(id, { isAuthoredByMe: true, isReviewRequestedFromMe: false, ...pr }, updatedAt);

function seed(reviewRequests: ActionableItem[], inFlight: ActionableItem[]) {
  useAppStore.getState().setPollResult({
    reviewRequests,
    inFlight,
    rateLimit: null,
    polledAt: "2026-05-12T00:00:00.000Z",
  });
  useAppStore.getState().setPollStatus({
    state: "ok",
    error: null,
    rateLimited: false,
    retryAfterSecs: null,
  });
}

const failing = { checkRuns: [{ name: "ci", status: "completed", conclusion: "failure" }] };

beforeEach(() => {
  useAppStore.getState().reset();
});

describe("NeedsActionSection", () => {
  test("shows a skeleton before the first poll lands", () => {
    render(<NeedsActionSection />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  test("renders every inclusion branch with its reason badge", () => {
    seed(
      [
        prItem("mention", { activity: { mentionsMe: 1, replyToMyReview: 0 } }, "2026-05-12T04:00:00Z"),
        prItem("review-failing", failing),
      ],
      [
        mine("ejected", {
          mergeQueue: {
            position: null,
            enteredAt: "2026-05-11T00:00:00Z",
            lastEjectionAt: new Date(Date.now() - 60_000).toISOString(),
          },
        }, "2026-05-12T03:00:00Z"),
        mine("failing", failing, "2026-05-12T02:00:00Z"),
        mine("reply", { activity: { mentionsMe: 0, replyToMyReview: 1 } }, "2026-05-12T01:00:00Z"),
        mine("healthy", {}),
      ],
    );
    render(<NeedsActionSection />);
    const section = screen.getByRole("region", { name: "Needs Action" });
    const rows = within(section).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Title mention"),
      expect.stringContaining("Title ejected"),
      expect.stringContaining("Title failing"),
      expect.stringContaining("Title reply"),
    ]);
    expect(within(rows[0]).getByText("@mention")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Kicked from queue")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Checks failing")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Review reply")).toBeInTheDocument();
    // Failing checks on someone else's PR stay in Review Requests only.
    expect(within(section).queryByText("Title review-failing")).toBeNull();
    expect(within(section).queryByText("Title healthy")).toBeNull();
  });

  test("hides review requests that aren't visible (score <= 0, Show-All off)", () => {
    seed(
      [prItem("hidden", { score: -100, activity: { mentionsMe: 1, replyToMyReview: 0 } })],
      [],
    );
    render(<NeedsActionSection />);
    expect(screen.getByText("Nothing needs you right now.")).toBeInTheDocument();
  });

  test("excludes muted repos", () => {
    seed([prItem("m", { activity: { mentionsMe: 1, replyToMyReview: 0 } })], []);
    useAppStore.getState().setMutes([{ scope: "repo", value: "acme/repo" }]);
    render(<NeedsActionSection />);
    expect(screen.getByText("Nothing needs you right now.")).toBeInTheDocument();
  });

  test("header count and collapse toggle", async () => {
    seed([prItem("m", { activity: { mentionsMe: 1, replyToMyReview: 0 } })], []);
    render(<NeedsActionSection />);
    const toggle = screen.getByRole("button", { name: /Needs Action/ });
    expect(toggle.textContent).toContain("1");
    await userEvent.click(toggle);
    expect(screen.queryByText("Title m")).toBeNull();
  });

  test("clicking a row selects the item", async () => {
    seed([prItem("m", { activity: { mentionsMe: 1, replyToMyReview: 0 } })], []);
    render(<NeedsActionSection />);
    await userEvent.click(screen.getByRole("button", { name: "Select Title m" }));
    expect(useAppStore.getState().selectedItemId).toBe("m");
  });
});
