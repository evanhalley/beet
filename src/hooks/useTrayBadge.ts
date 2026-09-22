"use client";

import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  applyMutes,
  applySnoozes,
  useAppStore,
  isReviewRequestVisible,
  selectShowAllReviews,
} from "@/lib/store";
import { countBadgeItems, selectNeedsAction } from "@/lib/needsAction";

const DEBOUNCE_MS = 150;

export function useTrayBadge(): void {
  const reviewRequests = useAppStore((s) => s.reviewRequests);
  const inFlight = useAppStore((s) => s.inFlight);
  const mutes = useAppStore((s) => s.mutes);
  const paused = useAppStore((s) => s.paused);
  const showAll = useAppStore(selectShowAllReviews);
  const suppressedIds = useAppStore((s) => s.suppressedIds);
  const snoozes = useAppStore((s) => s.snoozes);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Apply mutes before counting so the badge matches what the UI shows.
    // Only visible review requests count (score > 0 or showAll, not
    // suppressed/snoozed), plus the Needs Action items (SPECS §10) — session
    // list filters deliberately don't narrow the badge.
    const visibleReviews = applyMutes(reviewRequests, mutes).filter((r) =>
      isReviewRequestVisible(r, showAll, suppressedIds, snoozes),
    );
    const needsAction = selectNeedsAction(
      applySnoozes(applyMutes(inFlight, mutes), snoozes),
      visibleReviews,
    );
    const count = countBadgeItems(needsAction, visibleReviews);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      invoke("set_badge", { count, paused }).catch(() => {});
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [reviewRequests, inFlight, mutes, paused, showAll, suppressedIds, snoozes]);
}
