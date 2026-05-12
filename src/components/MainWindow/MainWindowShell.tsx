"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useAppStore, selectShowAllReviews } from "@/lib/store";
import type { ActionableItem } from "@/lib/types";
import { Sidebar } from "./Sidebar";
import { ListPane } from "./ListPane";
import { DetailPane } from "./DetailPane";
import { TitleBar } from "./TitleBar";
import { Splitter } from "./Splitter";

export interface MainWindowShellProps {
  onOpenSettings: () => void;
  settingsOpen?: boolean;
}

const DETAIL_WIDTH_KEY = "beet.detailWidth";
const DETAIL_WIDTH_DEFAULT = 380;
const DETAIL_WIDTH_MIN = 280;
const DETAIL_WIDTH_MAX = 720;

function clampDetailWidth(w: number): number {
  if (!Number.isFinite(w)) return DETAIL_WIDTH_DEFAULT;
  return Math.min(DETAIL_WIDTH_MAX, Math.max(DETAIL_WIDTH_MIN, Math.round(w)));
}

function pickAutoSelect(
  reviewRequests: ActionableItem[],
  showAll: boolean,
): ActionableItem | null {
  const visible = showAll
    ? reviewRequests
    : reviewRequests.filter((it) => (it.pr?.score ?? 0) > 0);
  if (visible.length === 0) return null;
  return [...visible].sort(
    (a, b) => (b.pr?.score ?? 0) - (a.pr?.score ?? 0),
  )[0];
}

export function MainWindowShell({
  onOpenSettings,
  settingsOpen = false,
}: MainWindowShellProps) {
  const selectedItemId = useAppStore((s) => s.selectedItemId);
  const reviewRequests = useAppStore((s) => s.reviewRequests);
  const showAll = useAppStore(selectShowAllReviews);

  const selected = useMemo<ActionableItem | null>(() => {
    if (selectedItemId) {
      const hit = reviewRequests.find((it) => it.id === selectedItemId);
      if (hit) return hit;
    }
    return pickAutoSelect(reviewRequests, showAll);
  }, [selectedItemId, reviewRequests, showAll]);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const [detailWidth, setDetailWidth] = useState<number>(() => {
    if (typeof window === "undefined") return DETAIL_WIDTH_DEFAULT;
    const raw = window.localStorage.getItem(DETAIL_WIDTH_KEY);
    if (raw == null) return DETAIL_WIDTH_DEFAULT;
    const parsed = Number(raw);
    return Number.isFinite(parsed)
      ? clampDetailWidth(parsed)
      : DETAIL_WIDTH_DEFAULT;
  });

  const onResize = useCallback((clientX: number) => {
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const next = clampDetailWidth(rect.right - clientX);
    setDetailWidth(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DETAIL_WIDTH_KEY, String(next));
    }
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        background: "var(--color-bg)",
      }}
    >
      <TitleBar onOpenSettings={onOpenSettings} settingsOpen={settingsOpen} />
      <div
        ref={gridRef}
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: `200px 1fr 4px ${detailWidth}px`,
          minHeight: 0,
        }}
      >
        <Sidebar activeSection="reviews" />
        <ListPane />
        <Splitter onResize={onResize} />
        <DetailPane item={selected} />
      </div>
    </div>
  );
}
