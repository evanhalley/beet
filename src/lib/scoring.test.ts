import { describe, test, expect } from "vitest";
import { scorePullRequests } from "./scoring";
import type { ActionableItem } from "@/lib/types";

function makeItem(overrides: Partial<ActionableItem["pr"]> = {}): ActionableItem {
  const now = new Date().toISOString();
  return {
    id: "pr:foo/bar#123",
    kind: "pr",
    title: "Test PR",
    url: "https://github.com/foo/bar/pull/123",
    repoFullName: "foo/bar",
    updatedAt: now,
    unread: true,
    dismissedUntilFingerprint: null,
    pr: {
      number: 123,
      author: "johndoe",
      body: null,
      isAuthoredByMe: false,
      isReviewRequestedFromMe: false,
      isAuthorOnMyTeam: false,
      iveCommented: false,
      iveReviewed: false,
      iveApproved: false,
      approvalCount: 0,
      isDraft: false,
      additions: 10,
      deletions: 10,
      createdAt: now,
      lifecycle: "open",
      taskUrls: [],
      score: 0,
      ...overrides,
    },
  };
}

describe("PR Prioritization Algorithm", () => {
  test("should score a PR from a team member highly", () => {
    const result = scorePullRequests([makeItem({ isAuthorOnMyTeam: true })]);
    expect(result.length).toBe(1);
    expect(result[0].pr?.score).toBe(6);
  });

  test("should add points for review request, comments, and reviews", () => {
    const result = scorePullRequests([
      makeItem({
        isReviewRequestedFromMe: true,
        iveCommented: true,
        iveReviewed: true,
      }),
    ]);
    expect(result.length).toBe(1);
    // 3 (review-requested) + 2 (comment) + 2 (review) = 7
    expect(result[0].pr?.score).toBe(7);
  });

  test("should filter out zero or negative scores", () => {
    const result = scorePullRequests([makeItem()]);
    expect(result.length).toBe(0);
  });

  test("should subtract points for large PRs and drafts", () => {
    const result = scorePullRequests([
      makeItem({
        isAuthorOnMyTeam: true, // +6
        additions: 300, // -1
        deletions: 300, // -1
        isDraft: true, // -5
      }),
    ]);
    // 6 - 1 - 1 - 5 = -1 → filtered out
    expect(result.length).toBe(0);
  });

  test("should treat renovate[bot] with harsh penalty", () => {
    const result = scorePullRequests(
      [
        makeItem({
          author: "renovate[bot]",
          isReviewRequestedFromMe: true,
          isAuthorOnMyTeam: true,
        }),
      ],
      false,
      ["renovate[bot]"],
    );
    // Penalized bot overwrites to -10 → filtered out
    expect(result.length).toBe(0);
  });

  test("showAll surfaces approved PRs at the bottom", () => {
    const approved = makeItem({ iveApproved: true, isAuthorOnMyTeam: true });
    const fresh = makeItem({ isAuthorOnMyTeam: true });
    fresh.id = "pr:foo/bar#456";
    const result = scorePullRequests([approved, fresh], true);
    expect(result.length).toBe(2);
    expect(result[0].id).toBe(fresh.id);
    expect(result[1].id).toBe(approved.id);
    expect(result[1].pr?.score).toBeLessThan(0);
  });

  test("stale rule overwrites to zero when both created and updated are > 60 days old", () => {
    const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const item = makeItem({ isAuthorOnMyTeam: true, createdAt: old });
    item.updatedAt = old;
    const result = scorePullRequests([item], true);
    expect(result.length).toBe(1);
    expect(result[0].pr?.score).toBe(0);
  });
});
