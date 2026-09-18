import { describe, expect, test } from "vitest";
import { isCodeOwner } from "../codeOwnership";
import type { ActionableItemPr } from "@/lib/types";

const base: ActionableItemPr = {
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
  additions: 1,
  deletions: 1,
  createdAt: "2026-05-08T10:00:00Z",
  lifecycle: "in_review",
  taskUrls: [],
  score: 0,
};

describe("isCodeOwner", () => {
  test("true when the user owns at least one changed file", () => {
    expect(
      isCodeOwner({
        ...base,
        codeOwnership: { ownedCount: 3, totalCount: 12, hasCodeowners: true, teamsResolved: true },
      }),
    ).toBe(true);
  });

  test("false when nothing is owned, or ownership was never resolved", () => {
    expect(
      isCodeOwner({
        ...base,
        codeOwnership: { ownedCount: 0, totalCount: 12, hasCodeowners: true, teamsResolved: true },
      }),
    ).toBe(false);
    expect(isCodeOwner(base)).toBe(false);
    expect(isCodeOwner(undefined)).toBe(false);
  });
});
