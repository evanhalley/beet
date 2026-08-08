import { describe, expect, test } from "vitest";
import { matchItems } from "../index";
import type { ActionableItem, ActionableItemPr } from "@/lib/types";

function makeItem(overrides: {
  id: string;
  title?: string;
  repoFullName?: string;
  updatedAt?: string;
  pr?: Partial<ActionableItemPr> | null;
}): ActionableItem {
  const basePr: ActionableItemPr = {
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
    additions: 0,
    deletions: 0,
    createdAt: "2026-05-01T00:00:00Z",
    lifecycle: "in_review",
    taskUrls: [],
    score: 1,
  };
  return {
    id: overrides.id,
    kind: "pr",
    title: overrides.title ?? `Title ${overrides.id}`,
    url: `https://github.com/acme/repo/pull/${overrides.id}`,
    repoFullName: overrides.repoFullName ?? "acme/repo",
    updatedAt: overrides.updatedAt ?? "2026-05-09T10:00:00Z",
    unread: false,
    dismissedUntilFingerprint: null,
    pr:
      overrides.pr === null
        ? undefined
        : { ...basePr, ...(overrides.pr ?? {}) },
  };
}

describe("matchItems", () => {
  test("returns [] for an empty query", () => {
    const items = [makeItem({ id: "a" })];
    expect(matchItems("", items)).toEqual([]);
    expect(matchItems("   ", items)).toEqual([]);
  });

  test("substring matches on title", () => {
    const items = [
      makeItem({ id: "a", title: "Refactor poll loop" }),
      makeItem({ id: "b", title: "Add rate-limit cache" }),
    ];
    expect(matchItems("rate", items).map((i) => i.id)).toEqual(["b"]);
  });

  test("substring matches on repoFullName", () => {
    const items = [
      makeItem({ id: "a", repoFullName: "acme/api" }),
      makeItem({ id: "b", repoFullName: "acme/web" }),
    ];
    expect(matchItems("acme/web", items).map((i) => i.id)).toEqual(["b"]);
  });

  test("matches on pr.number with and without the leading hash", () => {
    const items = [
      makeItem({ id: "a", pr: { number: 412 } }),
      makeItem({ id: "b", pr: { number: 9 } }),
    ];
    expect(matchItems("412", items).map((i) => i.id)).toEqual(["a"]);
    expect(matchItems("#412", items).map((i) => i.id)).toEqual(["a"]);
  });

  test("matches on pr.author", () => {
    const items = [
      makeItem({ id: "a", pr: { author: "rina" } }),
      makeItem({ id: "b", pr: { author: "octocat" } }),
    ];
    expect(matchItems("octo", items).map((i) => i.id)).toEqual(["b"]);
  });

  test("matches on the tail segment of a taskUrl", () => {
    const items = [
      makeItem({
        id: "a",
        pr: { taskUrls: ["https://jira.example.com/browse/PROJ-1234"] },
      }),
      makeItem({
        id: "b",
        pr: { taskUrls: ["https://jira.example.com/browse/PROJ-9999"] },
      }),
    ];
    expect(matchItems("PROJ-1234", items).map((i) => i.id)).toEqual(["a"]);
  });

  test("initials matches rank beneath substring hits", () => {
    const items = [
      // initials = "arc"; substring miss.
      makeItem({ id: "a", title: "Add rate-limit cache" }),
      // substring hit on "arc".
      makeItem({ id: "b", title: "Architecture overhaul" }),
    ];
    expect(matchItems("arc", items).map((i) => i.id)).toEqual(["b", "a"]);
  });

  test("tie-break by updatedAt desc when two items hit at the same position", () => {
    const items = [
      makeItem({
        id: "old",
        title: "Refactor poll loop",
        updatedAt: "2026-05-01T00:00:00Z",
      }),
      makeItem({
        id: "new",
        title: "Refactor poll loop",
        updatedAt: "2026-05-09T00:00:00Z",
      }),
    ];
    expect(matchItems("refactor", items).map((i) => i.id)).toEqual([
      "new",
      "old",
    ]);
  });

  test("matches an item with no pr block by title / repo without crashing", () => {
    const items = [
      makeItem({
        id: "run",
        title: "Nightly deploy",
        repoFullName: "acme/infra",
        pr: null,
      }),
    ];
    expect(matchItems("nightly", items).map((i) => i.id)).toEqual(["run"]);
    expect(matchItems("acme/infra", items).map((i) => i.id)).toEqual(["run"]);
  });

  test("is case-insensitive", () => {
    const items = [makeItem({ id: "a", title: "Refactor POLL Loop" })];
    expect(matchItems("poll", items).map((i) => i.id)).toEqual(["a"]);
    expect(matchItems("POLL", items).map((i) => i.id)).toEqual(["a"]);
  });
});
