import type { ActionableItem } from "@/lib/types";

// Session-scoped list filters driven by the sidebar Filters group. All default
// to off; toggled independently (multi-select). Held in the Zustand store, not
// persisted — an app restart clears them (mirrors `showAllReviewsOverride`).
export interface ListFilters {
  failingOnly: boolean;
  pendingOnly: boolean;
  myTeamOnly: boolean;
}

export const EMPTY_LIST_FILTERS: ListFilters = {
  failingOnly: false,
  pendingOnly: false,
  myTeamOnly: false,
};

export function hasActiveListFilter(f: ListFilters): boolean {
  return f.failingOnly || f.pendingOnly || f.myTeamOnly;
}

// An item is "failing" when any of its checks reached a `failure` conclusion.
// PR rows aggregate per-commit `checkRuns` and rolled-up `associatedRuns`;
// standalone-run rows carry the verdict directly on `run`.
export function itemHasFailingChecks(item: ActionableItem): boolean {
  if (item.pr) {
    const checks = item.pr.checkRuns ?? [];
    const runs = item.pr.associatedRuns ?? [];
    return (
      checks.some((c) => c.conclusion === "failure") ||
      runs.some((r) => r.conclusion === "failure")
    );
  }
  if (item.run) {
    return item.run.conclusion === "failure";
  }
  return false;
}

// An item is "pending" when any of its checks is still running or queued — i.e.
// has not reached a terminal `completed` status yet.
export function itemHasPendingChecks(item: ActionableItem): boolean {
  if (item.pr) {
    const checks = item.pr.checkRuns ?? [];
    const runs = item.pr.associatedRuns ?? [];
    return (
      checks.some((c) => c.status === "queued" || c.status === "in_progress") ||
      runs.some((r) => r.status !== "completed")
    );
  }
  if (item.run) {
    return item.run.status !== "completed";
  }
  return false;
}

// Visibility predicate for the live actionable sections.
//
// Two independent axes, AND-ed together:
//   - Check status: Failing and Pending describe the same axis, so they OR — an
//     item passes if it matches *either* active toggle. With both off, the axis
//     is a pass-through. An item with no check data fails whenever a check
//     toggle is on.
//   - My team: an item passes only if its PR author is on one of my teams.
//     Standalone runs (no PR) never match, so they drop out when this is on.
//
// `teamsConfigured` guards the My-team axis: with no teams set in Settings,
// `isAuthorOnMyTeam` is always false, which would strand the whole list — so we
// treat the toggle as inert. The sidebar also disables it in that state; this is
// the belt-and-suspenders that keeps a stale session toggle from hiding rows.
export function passesListFilters(
  item: ActionableItem,
  f: ListFilters,
  teamsConfigured: boolean,
): boolean {
  if (f.myTeamOnly && teamsConfigured && !item.pr?.isAuthorOnMyTeam) {
    return false;
  }

  if (f.failingOnly || f.pendingOnly) {
    const matchesCheck =
      (f.failingOnly && itemHasFailingChecks(item)) ||
      (f.pendingOnly && itemHasPendingChecks(item));
    if (!matchesCheck) return false;
  }

  return true;
}

// Filter `items` by the active list filters. Returns the input untouched when no
// filter is active (cheap no-op, mirrors `applyMutes` in store.ts). Called at
// the selector layer so the raw poll cache stays intact — clearing a filter
// restores items without a refetch.
export function applyListFilters(
  items: ActionableItem[],
  f: ListFilters,
  teamsConfigured: boolean,
): ActionableItem[] {
  if (!hasActiveListFilter(f)) return items;
  return items.filter((item) => passesListFilters(item, f, teamsConfigured));
}
