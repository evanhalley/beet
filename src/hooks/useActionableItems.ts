"use client";

import { useMemo } from "react";
import { useReviewRequests } from "@/hooks/useReviewRequests";
import { useMyOpenPrs } from "@/hooks/useMyOpenPrs";
import type { ActionableItem } from "@/lib/types";

export interface UseActionableItemsResult {
  reviewRequests: ActionableItem[];
  inFlight: ActionableItem[];
  // Flat lookup across every section, for resolving a selected item by id.
  byId: Map<string, ActionableItem>;
  isLoading: boolean;
  isFetching: boolean;
}

export function useActionableItems(): UseActionableItemsResult {
  const reviews = useReviewRequests();
  const inFlight = useMyOpenPrs();

  const byId = useMemo(() => {
    const map = new Map<string, ActionableItem>();
    for (const item of reviews.items) map.set(item.id, item);
    for (const item of inFlight.items) map.set(item.id, item);
    return map;
  }, [reviews.items, inFlight.items]);

  return {
    reviewRequests: reviews.items,
    inFlight: inFlight.items,
    byId,
    isLoading: reviews.isLoading || inFlight.isLoading,
    isFetching: reviews.isFetching || inFlight.isFetching,
  };
}
