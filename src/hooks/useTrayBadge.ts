"use client";

import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/lib/store";

const DEBOUNCE_MS = 150;

export function useTrayBadge(): void {
  const reviewRequests = useAppStore((s) => s.reviewRequests);
  const paused = useAppStore((s) => s.paused);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const count = reviewRequests.filter((r) => r.unread).length;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      invoke("set_badge", { count, paused }).catch(() => {});
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [reviewRequests, paused]);
}
