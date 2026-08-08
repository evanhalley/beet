import { describe, expect, test } from "vitest";
import {
  EMPTY_LIST_FILTERS,
  applyListFilters,
  hasActiveListFilter,
  itemHasFailingChecks,
  itemHasPendingChecks,
  passesListFilters,
  type ListFilters,
} from "../filters";
import type {
  ActionableItem,
  ActionableItemPr,
  ActionableItemRun,
} from "../types";

function prItem(
  id: string,
  pr: Partial<ActionableItemPr> = {},
): ActionableItem {
  return {
    id,
    kind: "pr",
    title: id,
    url: `https://github.com/${id}`,
    repoFullName: "acme/api",
    updatedAt: "2026-05-19T00:00:00.000Z",
    unread: false,
    dismissedUntilFingerprint: null,
    pr: {
      number: 1,
      author: "octocat",
      body: null,
      isAuthoredByMe: false,
      isReviewRequestedFromMe: false,
      isAuthorOnMyTeam: false,
      iveCommented: false,
      iveReviewed: false,
      iveApproved: false,
      approvalCount: 0,
      isDraft: false,
      additions: 0,
      deletions: 0,
      createdAt: "2026-05-19T00:00:00.000Z",
      lifecycle: "open",
      taskUrls: [],
      score: 1,
      ...pr,
    },
  };
}

function runItem(
  id: string,
  run: Partial<ActionableItemRun> = {},
): ActionableItem {
  return {
    id,
    kind: "standalone_run",
    title: id,
    url: `https://github.com/${id}`,
    repoFullName: "acme/api",
    updatedAt: "2026-05-19T00:00:00.000Z",
    unread: false,
    dismissedUntilFingerprint: null,
    run: {
      workflowName: "CI",
      event: "push",
      status: "completed",
      conclusion: "success",
      branch: "main",
      sha: "abc123",
      runNumber: 1,
      actorLogin: "octocat",
      runUrl: "https://github.com/acme/api/actions/runs/1",
      startedAt: null,
      completedAt: null,
      ...run,
    },
  };
}

const FAILING: ListFilters = { ...EMPTY_LIST_FILTERS, failingOnly: true };
const PENDING: ListFilters = { ...EMPTY_LIST_FILTERS, pendingOnly: true };
const MY_TEAM: ListFilters = { ...EMPTY_LIST_FILTERS, myTeamOnly: true };

describe("itemHasFailingChecks", () => {
  test("PR with a failing check run", () => {
    const item = prItem("a", {
      checkRuns: [{ name: "test", status: "completed", conclusion: "failure" }],
    });
    expect(itemHasFailingChecks(item)).toBe(true);
  });

  test("PR with a failing associated run", () => {
    const item = prItem("a", {
      associatedRuns: [
        {
          workflowName: "CI",
          status: "completed",
          conclusion: "failure",
          runUrl: "x",
          completedAt: null,
        },
      ],
    });
    expect(itemHasFailingChecks(item)).toBe(true);
  });

  test("standalone failing run", () => {
    expect(itemHasFailingChecks(runItem("r", { conclusion: "failure" }))).toBe(
      true,
    );
  });

  test("all-green PR is not failing", () => {
    const item = prItem("a", {
      checkRuns: [{ name: "test", status: "completed", conclusion: "success" }],
    });
    expect(itemHasFailingChecks(item)).toBe(false);
  });

  test("PR with no check data is not failing", () => {
    expect(itemHasFailingChecks(prItem("a"))).toBe(false);
  });
});

describe("itemHasPendingChecks", () => {
  test("PR with an in-progress check run", () => {
    const item = prItem("a", {
      checkRuns: [{ name: "test", status: "in_progress" }],
    });
    expect(itemHasPendingChecks(item)).toBe(true);
  });

  test("PR with a queued check run", () => {
    const item = prItem("a", {
      checkRuns: [{ name: "test", status: "queued" }],
    });
    expect(itemHasPendingChecks(item)).toBe(true);
  });

  test("PR with a still-running associated run", () => {
    const item = prItem("a", {
      associatedRuns: [
        {
          workflowName: "CI",
          status: "in_progress",
          runUrl: "x",
          completedAt: null,
        },
      ],
    });
    expect(itemHasPendingChecks(item)).toBe(true);
  });

  test("standalone running run", () => {
    expect(itemHasPendingChecks(runItem("r", { status: "in_progress" }))).toBe(
      true,
    );
  });

  test("completed checks are not pending", () => {
    const item = prItem("a", {
      checkRuns: [{ name: "test", status: "completed", conclusion: "success" }],
    });
    expect(itemHasPendingChecks(item)).toBe(false);
  });
});

describe("passesListFilters", () => {
  test("no filters active: everything passes", () => {
    expect(
      passesListFilters(prItem("a"), EMPTY_LIST_FILTERS, true),
    ).toBe(true);
  });

  test("failingOnly hides items with no failing checks", () => {
    const passing = prItem("a", {
      checkRuns: [{ name: "t", status: "completed", conclusion: "success" }],
    });
    const failing = prItem("b", {
      checkRuns: [{ name: "t", status: "completed", conclusion: "failure" }],
    });
    expect(passesListFilters(passing, FAILING, true)).toBe(false);
    expect(passesListFilters(failing, FAILING, true)).toBe(true);
  });

  test("item with no checks is hidden under a check filter", () => {
    expect(passesListFilters(prItem("a"), FAILING, true)).toBe(false);
    expect(passesListFilters(prItem("a"), PENDING, true)).toBe(false);
  });

  test("failing+pending is an OR on the check axis", () => {
    const both: ListFilters = {
      ...EMPTY_LIST_FILTERS,
      failingOnly: true,
      pendingOnly: true,
    };
    const failing = prItem("a", {
      checkRuns: [{ name: "t", status: "completed", conclusion: "failure" }],
    });
    const pending = prItem("b", {
      checkRuns: [{ name: "t", status: "in_progress" }],
    });
    const green = prItem("c", {
      checkRuns: [{ name: "t", status: "completed", conclusion: "success" }],
    });
    expect(passesListFilters(failing, both, true)).toBe(true);
    expect(passesListFilters(pending, both, true)).toBe(true);
    expect(passesListFilters(green, both, true)).toBe(false);
  });

  test("myTeamOnly keeps team PRs and drops others / standalone runs", () => {
    const mine = prItem("a", { isAuthorOnMyTeam: true });
    const theirs = prItem("b", { isAuthorOnMyTeam: false });
    expect(passesListFilters(mine, MY_TEAM, true)).toBe(true);
    expect(passesListFilters(theirs, MY_TEAM, true)).toBe(false);
    expect(passesListFilters(runItem("r"), MY_TEAM, true)).toBe(false);
  });

  test("myTeam AND failing: both axes must hold", () => {
    const filters: ListFilters = {
      ...EMPTY_LIST_FILTERS,
      myTeamOnly: true,
      failingOnly: true,
    };
    const teamFailing = prItem("a", {
      isAuthorOnMyTeam: true,
      checkRuns: [{ name: "t", status: "completed", conclusion: "failure" }],
    });
    const teamGreen = prItem("b", {
      isAuthorOnMyTeam: true,
      checkRuns: [{ name: "t", status: "completed", conclusion: "success" }],
    });
    expect(passesListFilters(teamFailing, filters, true)).toBe(true);
    expect(passesListFilters(teamGreen, filters, true)).toBe(false);
  });

  test("no-teams guard: myTeamOnly is inert when teams unconfigured", () => {
    const theirs = prItem("b", { isAuthorOnMyTeam: false });
    expect(passesListFilters(theirs, MY_TEAM, false)).toBe(true);
  });
});

describe("applyListFilters", () => {
  test("no-op (same reference) when no filter is active", () => {
    const items = [prItem("a"), prItem("b")];
    expect(applyListFilters(items, EMPTY_LIST_FILTERS, true)).toBe(items);
  });

  test("filters the list when active", () => {
    const failing = prItem("a", {
      checkRuns: [{ name: "t", status: "completed", conclusion: "failure" }],
    });
    const green = prItem("b", {
      checkRuns: [{ name: "t", status: "completed", conclusion: "success" }],
    });
    expect(applyListFilters([failing, green], FAILING, true)).toEqual([
      failing,
    ]);
  });
});

describe("hasActiveListFilter", () => {
  test("false when all off, true when any on", () => {
    expect(hasActiveListFilter(EMPTY_LIST_FILTERS)).toBe(false);
    expect(hasActiveListFilter(FAILING)).toBe(true);
    expect(hasActiveListFilter(MY_TEAM)).toBe(true);
  });

  test("myTeamOnly does not count as active when teams are unconfigured", () => {
    // Consistent with the passesListFilters guard: an inert toggle must not
    // read as "active" (Clear action / filter-aware empty copy).
    expect(hasActiveListFilter(MY_TEAM, false)).toBe(false);
    expect(hasActiveListFilter(FAILING, false)).toBe(true);
  });

  test("applyListFilters is a true no-op when only myTeamOnly is on but unconfigured", () => {
    const items = [prItem("a"), prItem("b", { isAuthorOnMyTeam: true })];
    expect(applyListFilters(items, MY_TEAM, false)).toBe(items);
  });
});
