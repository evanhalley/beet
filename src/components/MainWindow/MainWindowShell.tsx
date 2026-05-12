"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const SIDEBAR_COLLAPSED_KEY = "beet.sidebarCollapsed";
const SIDEBAR_WIDTH_EXPANDED = 200;
const SIDEBAR_WIDTH_COLLAPSED = 44;

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [detailWidth, setDetailWidth] = useState<number>(DETAIL_WIDTH_DEFAULT);

  // Hydrate persisted layout state from localStorage on mount.
  // Kept in an effect (not a lazy initializer) so SSR/static-build markup
  // matches the client's first render, then we sync up post-hydration.
  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored === "1") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSidebarCollapsed(true);
    }
    const rawWidth = window.localStorage.getItem(DETAIL_WIDTH_KEY);
    if (rawWidth != null) {
      const parsed = Number(rawWidth);
      if (Number.isFinite(parsed)) {
        setDetailWidth(clampDetailWidth(parsed));
      }
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }, []);
  const sidebarWidth = sidebarCollapsed
    ? SIDEBAR_WIDTH_COLLAPSED
    : SIDEBAR_WIDTH_EXPANDED;

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
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div
          style={{
            width: sidebarWidth,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            transition: "width 180ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <Sidebar
            activeSection="reviews"
            collapsed={sidebarCollapsed}
            onToggleCollapsed={toggleSidebar}
          />
        </div>
        <div
          ref={gridRef}
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: `1fr 1px ${detailWidth}px`,
            minHeight: 0,
          }}
        >
          <ListPane />
          <Splitter onResize={onResize} />
          <DetailPane item={selected} />
        </div>
      </div>
    </div>
  );
}
