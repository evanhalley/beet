"use client";

import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { applyMutes, useAppStore, isReviewRequestVisible, selectShowAllReviews } from "@/lib/store";

const DEBOUNCE_MS = 150;

export function useTrayBadge(): void {
  const reviewRequests = useAppStore((s) => s.reviewRequests);
  const mutes = useAppStore((s) => s.mutes);
  const paused = useAppStore((s) => s.paused);
  const showAll = useAppStore(selectShowAllReviews);
  const suppressedIds = useAppStore((s) => s.suppressedIds);
  const snoozes = useAppStore((s) => s.snoozes);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Apply mute filter before counting so the badge matches what the UI shows.
    const visible = applyMutes(reviewRequests, mutes);
    // Only count unread items that are actually visible (score > 0, or showAll),
    // and not suppressed — so the badge matches the rendered Review Requests list.
    const count = visible
      .filter(
        (r) =>
          r.unread &&
          isReviewRequestVisible(r, showAll, suppressedIds, snoozes),
      )
      .length;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      invoke("set_badge", { count, paused }).catch(() => {});
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [reviewRequests, mutes, paused, showAll, suppressedIds, snoozes]);
}
