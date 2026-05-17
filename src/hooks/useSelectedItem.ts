"use client";

import {
  isReviewRequestVisible,
  selectShowAllReviews,
  useAppStore,
} from "@/lib/store";
import type { ActionableItem } from "@/lib/types";

// Resolves the store's selectedItemId against the live data the user can
// actually see. Returns null when nothing is selected, the id no longer
// resolves at all (a "ghost" selection), OR the selected review-request has
// dropped out of view (Show-All was toggled off). The unresolved case lets
// MainWindowShell's existing auto-pick logic repair the selection.
export function useSelectedItem(): ActionableItem | null {
  const selectedItemId = useAppStore((s) => s.selectedItemId);
  const reviewRequests = useAppStore((s) => s.reviewRequests);
  const inFlight = useAppStore((s) => s.inFlight);
  const showAll = useAppStore(selectShowAllReviews);
  if (!selectedItemId) return null;

  // In-flight items are always visible — no filter applies here.
  const inFlightHit = inFlight.find((it) => it.id === selectedItemId);
  if (inFlightHit) return inFlightHit;

  // Review-requests honor the same visibility predicate as the rendered list.
  const reviewHit = reviewRequests.find((it) => it.id === selectedItemId);
  if (!reviewHit) return null;
  return isReviewRequestVisible(reviewHit, showAll) ? reviewHit : null;
}
