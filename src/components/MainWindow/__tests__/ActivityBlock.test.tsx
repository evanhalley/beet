import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { ActivityBlock, groupActivity, mentionsUser } from "../ActivityBlock";
import type { ActionableItem, PrComment, PrCommentsResult } from "@/lib/types";

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(async () => {}),
}));

const invokeMock = vi.mocked(invoke);
const openMock = vi.mocked(open);

beforeEach(() => {
  invokeMock.mockReset();
  openMock.mockReset();
});

afterEach(() => {
  invokeMock.mockReset();
});

const item: ActionableItem = {
  id: "pr:acme/repo#42",
  kind: "pr",
  title: "Patch the migrator",
  url: "https://github.com/acme/repo/pull/42",
  repoFullName: "acme/repo",
  updatedAt: "2026-05-09T10:00:00Z",
  unread: false,
  dismissedUntilFingerprint: null,
  pr: {
    number: 42,
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
    additions: 1,
    deletions: 1,
    createdAt: "2026-05-08T10:00:00Z",
    lifecycle: "in_review",
    taskUrls: [],
    score: 3,
  },
};

function comment(
  id: number,
  author: string,
  body: string,
  extra: Partial<PrComment> = {},
): PrComment {
  return {
    id,
    kind: "issue",
    author,
    body,
    createdAt: `2026-05-09T0${id}:00:00Z`,
    htmlUrl: `https://github.com/acme/repo/pull/42#c${id}`,
    ...extra,
  };
}

const result: PrCommentsResult = {
  comments: [
    comment(4, "kai", "LGTM"),
    comment(1, "rina", "Can @evan look at the cache?"),
    comment(2, "evan", "Why not fall back?", { kind: "review", path: "src/a.ts" }),
    comment(3, "rina", "Done, see latest.", { kind: "review", inReplyToId: 2, path: "src/a.ts" }),
  ],
  username: "evan",
};

describe("mentionsUser", () => {
  test("matches whole handles, case-insensitively", () => {
    expect(mentionsUser("hey @evan", "evan")).toBe(true);
    expect(mentionsUser("@Evan: thoughts?", "evan")).toBe(true);
    expect(mentionsUser("hey @evanh", "evan")).toBe(false);
    expect(mentionsUser("hey @evan-bot", "evan")).toBe(false);
    expect(mentionsUser("mail evan@example.com", "evan")).toBe(false);
    expect(mentionsUser("hey @evan", "")).toBe(false);
  });
});

describe("groupActivity", () => {
  test("nests replies under their root, oldest first", () => {
    const threads = groupActivity(result.comments);
    expect(threads.map((t) => t.root.id)).toEqual([1, 2, 4]);
    expect(threads[1].replies.map((r) => r.id)).toEqual([3]);
  });

  test("a reply whose root is missing stands alone", () => {
    const threads = groupActivity([comment(5, "kai", "orphan", { inReplyToId: 99 })]);
    expect(threads).toHaveLength(1);
    expect(threads[0].root.id).toBe(5);
  });
});

describe("ActivityBlock", () => {
  test("shows a skeleton while loading", () => {
    invokeMock.mockReturnValueOnce(new Promise(() => {}));
    render(<ActivityBlock item={item} />);
    expect(screen.getByRole("status", { name: "Loading activity" })).toBeInTheDocument();
  });

  test("renders comments with replies grouped and mentions highlighted", async () => {
    invokeMock.mockResolvedValueOnce(result);
    render(<ActivityBlock item={item} />);
    const section = screen.getByRole("region", { name: "Activity" });
    await waitFor(() => expect(within(section).getAllByRole("listitem")).toHaveLength(4));
    const rows = within(section).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("@rina"),
      expect.stringContaining("@evan"),
      expect.stringContaining("Done, see latest."),
      expect.stringContaining("@kai"),
    ]);
    // The @evan mention by someone else is highlighted; nothing else is.
    expect(rows[0]).toHaveAttribute("data-mention", "true");
    expect(within(rows[0]).getByText("@mention")).toBeInTheDocument();
    expect(rows.filter((r) => r.hasAttribute("data-mention"))).toHaveLength(1);
    // The reply is indented under its root.
    expect(rows[2].style.paddingLeft).toBe("20px");
  });

  test("clicking a comment opens it on GitHub", async () => {
    invokeMock.mockResolvedValueOnce(result);
    render(<ActivityBlock item={item} />);
    await userEvent.click(await screen.findByText("LGTM"));
    expect(openMock).toHaveBeenCalledWith("https://github.com/acme/repo/pull/42#c4");
  });

  test("empty and error states", async () => {
    invokeMock.mockResolvedValueOnce({ comments: [], username: "evan" });
    const { unmount } = render(<ActivityBlock item={item} />);
    expect(await screen.findByText("No comments yet.")).toBeInTheDocument();
    unmount();

    invokeMock.mockRejectedValueOnce(new Error("403"));
    render(<ActivityBlock item={item} />);
    expect(await screen.findByText("Couldn’t load comments.")).toBeInTheDocument();
  });
});
