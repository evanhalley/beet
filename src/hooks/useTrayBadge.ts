"use client";

import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore, isReviewRequestVisible, selectShowAllReviews } from "@/lib/store";

const DEBOUNCE_MS = 150;

export function useTrayBadge(): void {
  const reviewRequests = useAppStore((s) => s.reviewRequests);
  const paused = useAppStore((s) => s.paused);
  const showAll = useAppStore(selectShowAllReviews);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Only count unread items that are actually visible (score > 0, or showAll).
    const count = reviewRequests
      .filter((r) => r.unread && isReviewRequestVisible(r, showAll))
      .length;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      invoke("set_badge", { count, paused }).catch(() => {});
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [reviewRequests, paused, showAll]);
}
