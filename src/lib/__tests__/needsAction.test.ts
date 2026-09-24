import { describe, expect, test } from "vitest";
import {
  EJECTION_WINDOW_MS,
  countBadgeItems,
  needsActionReasons,
  primaryReason,
  selectNeedsAction,
} from "../needsAction";
import type { ActionableItem, ActionableItemPr } from "../types";

const NOW = Date.parse("2026-05-20T12:00:00.000Z");

function prItem(
  id: string,
  pr: Partial<ActionableItemPr> = {},
  item: Partial<ActionableItem> = {},
): ActionableItem {
  return {
    id,
    kind: "pr",
    title: id,
    url: `https://github.com/${id}`,
    repoFullName: "acme/api",
    updatedAt: "2026-05-20T00:00:00.000Z",
    unread: false,
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
      additions: 0,
      deletions: 0,
      createdAt: "2026-05-19T00:00:00.000Z",
      lifecycle: "in_review",
      taskUrls: [],
      score: 3,
      ...pr,
    },
    ...item,
  };
}

const mine = (id: string, pr: Partial<ActionableItemPr> = {}) =>
  prItem(id, { isAuthoredByMe: true, isReviewRequestedFromMe: false, ...pr });

const failing = { checkRuns: [{ name: "ci", status: "completed", conclusion: "failure" }] };
const ejectedAgo = (ms: number) => ({
  mergeQueue: {
    position: null,
    enteredAt: "2026-05-19T00:00:00.000Z",
    lastEjectionAt: new Date(NOW - ms).toISOString(),
  },
});

describe("needsActionReasons", () => {
  test("ejection within 24h on my PR", () => {
    expect(needsActionReasons(mine("a", ejectedAgo(60_000)), NOW)).toEqual(["ejected"]);
  });

  test("ejection older than 24h no longer counts", () => {
    expect(
      needsActionReasons(mine("a", ejectedAgo(EJECTION_WINDOW_MS + 1)), NOW),
    ).toEqual([]);
  });

  test("failing checks on my PR", () => {
    expect(needsActionReasons(mine("a", failing), NOW)).toEqual(["checks_failing"]);
  });

  test("failing checks on someone else's PR do not count", () => {
    expect(needsActionReasons(prItem("a", failing), NOW)).toEqual([]);
  });

  test("mentions and replies count on any PR", () => {
    expect(
      needsActionReasons(
        prItem("a", { activity: { mentionsMe: 1, replyToMyReview: 0 } }),
        NOW,
      ),
    ).toEqual(["mention"]);
    expect(
      needsActionReasons(
        mine("b", { activity: { mentionsMe: 0, replyToMyReview: 2 } }),
        NOW,
      ),
    ).toEqual(["reply"]);
  });

  test("zeroed activity does not count", () => {
    expect(
      needsActionReasons(
        prItem("a", { activity: { mentionsMe: 0, replyToMyReview: 0 } }),
        NOW,
      ),
    ).toEqual([]);
  });

  test("runs never qualify", () => {
    const run: ActionableItem = { ...prItem("r"), kind: "standalone_run", pr: undefined };
    expect(needsActionReasons(run, NOW)).toEqual([]);
  });
});

describe("primaryReason", () => {
  test("priority is ejected > checks_failing > mention > reply", () => {
    const all = mine("a", {
      ...ejectedAgo(1000),
      ...failing,
      activity: { mentionsMe: 1, replyToMyReview: 1 },
    });
    expect(primaryReason(all, NOW)).toBe("ejected");
    expect(
      primaryReason(
        mine("b", { ...failing, activity: { mentionsMe: 1, replyToMyReview: 1 } }),
        NOW,
      ),
    ).toBe("checks_failing");
    expect(
      primaryReason(
        prItem("c", { activity: { mentionsMe: 1, replyToMyReview: 1 } }),
        NOW,
      ),
    ).toBe("mention");
    expect(primaryReason(prItem("d"), NOW)).toBeNull();
  });
});

describe("selectNeedsAction", () => {
  test("keeps qualifying items from both sections, newest first, deduped", () => {
    const ejected = mine("ejected", {
      ...ejectedAgo(1000),
    });
    ejected.updatedAt = "2026-05-20T01:00:00.000Z";
    const mentioned = prItem("mentioned", {
      activity: { mentionsMe: 1, replyToMyReview: 0 },
    });
    mentioned.updatedAt = "2026-05-20T03:00:00.000Z";
    const quiet = prItem("quiet");

    const result = selectNeedsAction(
      [ejected, mine("healthy")],
      [mentioned, quiet, mentioned],
      NOW,
    );
    expect(result.map((i) => i.id)).toEqual(["mentioned", "ejected"]);
  });

  test("only considers the lists it is given (callers pre-filter mutes/visibility)", () => {
    expect(selectNeedsAction([], [], NOW)).toEqual([]);
  });
});

describe("countBadgeItems", () => {
  test("counts unread items once across Needs Action and Review Requests", () => {
    const both = prItem("both", {}, { unread: true });
    const needsOnly = mine("needs", failing);
    needsOnly.unread = true;
    const readReview = prItem("read");
    expect(countBadgeItems([both, needsOnly], [both, readReview])).toBe(2);
  });
});
