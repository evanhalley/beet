"use client";

import { useMemo } from "react";
import { useAppStore, selectShowAllReviews } from "@/lib/store";
import type { ActionableItem } from "@/lib/types";
import { Sidebar } from "./Sidebar";
import { ListPane } from "./ListPane";
import { DetailPane } from "./DetailPane";
import { TitleBar } from "./TitleBar";

export interface MainWindowShellProps {
  onOpenSettings: () => void;
  settingsOpen?: boolean;
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
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "200px 1fr 380px",
          minHeight: 0,
        }}
      >
        <Sidebar activeSection="reviews" />
        <ListPane />
        <DetailPane item={selected} />
      </div>
    </div>
  );
}
