"use client";

import { applyMutes, useAppStore } from "@/lib/store";
import { applyListFilters } from "@/lib/filters";
import type { ActionableItem } from "@/lib/types";

export interface UseActionableItemsResult {
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
  const listFilters = useAppStore((s) => s.listFilters);
  const teamsConfigured = useAppStore((s) => s.settings.teams.length > 0);

  // Mutes apply everywhere; the session list filters narrow only the live
  // actionable sections — Recently Resolved keeps its full set, since a
  // check-status / my-team lens on already-resolved items is noise.
  const filter = (items: ActionableItem[]) =>
    applyListFilters(applyMutes(items, mutes), listFilters, teamsConfigured);

  return {
    reviewRequests: filter(reviewRequests),
    inFlight: filter(inFlight),
    standaloneRuns: filter(standaloneRuns),
    recentlyResolved: applyMutes(recentlyResolved, mutes),
    byId,
    // "idle" = no poll cycle has completed yet.
    isLoading: pollState === "idle",
    isFetching: pollState === "polling",
  };
}
