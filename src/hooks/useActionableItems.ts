"use client";

import {
  applyMutes,
  applySnoozes,
  isReviewRequestVisible,
  selectShowAllReviews,
  useAppStore,
} from "@/lib/store";
import { applyListFilters } from "@/lib/filters";
import { selectNeedsAction } from "@/lib/needsAction";
import type { ActionableItem } from "@/lib/types";

export interface UseActionableItemsResult {
  // Derived: the urgent slice of In Flight + visible Review Requests (#25).
  // Those items also stay in their home sections.
  needsAction: ActionableItem[];
  reviewRequests: ActionableItem[];
  inFlight: ActionableItem[];
  standaloneRuns: ActionableItem[];
  recentlyResolved: ActionableItem[];
  // Flat lookup across every section, for resolving a selected item by id.
  byId: Map<string, ActionableItem>;
  isLoading: boolean;
  isFetching: boolean;
}

// Server state now lives in the Zustand store, fed by the Rust poll loop via
// usePollEvents. This hook is a thin selector kept for component compatibility.
// Mute rules are applied here so every consumer sees the filtered view without
// needing to know about muting — the raw poll cache stays intact in the store.
export function useActionableItems(): UseActionableItemsResult {
  const reviewRequests = useAppStore((s) => s.reviewRequests);
  const inFlight = useAppStore((s) => s.inFlight);
  const standaloneRuns = useAppStore((s) => s.standaloneRuns);
  const recentlyResolved = useAppStore((s) => s.recentlyResolved);
  const byId = useAppStore((s) => s.byId);
  const pollState = useAppStore((s) => s.pollState);
  const mutes = useAppStore((s) => s.mutes);
  const snoozes = useAppStore((s) => s.snoozes);
  const listFilters = useAppStore((s) => s.listFilters);
  const teamsConfigured = useAppStore((s) => s.settings.teams.length > 0);
  const showAll = useAppStore(selectShowAllReviews);
  const suppressedIds = useAppStore((s) => s.suppressedIds);

  // Mutes apply everywhere; the session list filters narrow only the live
  // actionable sections — Recently Resolved keeps its full set, since a
  // check-status / my-team lens on already-resolved items is noise.
  const filter = (items: ActionableItem[]) =>
    applyListFilters(applyMutes(items, mutes), listFilters, teamsConfigured);

  // Review requests keep snoozed items here — isReviewRequestVisible hides
  // them downstream, and Show-All must still be able to reveal them.
  const filteredReviews = filter(reviewRequests);
  const filteredInFlight = applySnoozes(filter(inFlight), snoozes);
  const needsAction = selectNeedsAction(
    filteredInFlight,
    filteredReviews.filter((it) =>
      isReviewRequestVisible(it, showAll, suppressedIds, snoozes),
    ),
  );

  return {
    needsAction,
    reviewRequests: filteredReviews,
    inFlight: filteredInFlight,
    standaloneRuns: applySnoozes(filter(standaloneRuns), snoozes),
    recentlyResolved: applyMutes(recentlyResolved, mutes),
    byId,
    // "idle" = no poll cycle has completed yet.
    isLoading: pollState === "idle",
    isFetching: pollState === "polling",
  };
}
