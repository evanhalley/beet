"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { selectShowAllReviews, useAppStore } from "@/lib/store";
import { useActionableItems } from "@/hooks/useActionableItems";
import { useSelectedItem } from "@/hooks/useSelectedItem";
import type { ActionableItem } from "@/lib/types";
import { Sidebar } from "./Sidebar";
import { ListPane } from "./ListPane";
import { DetailPane } from "./DetailPane";
import { TitleBar } from "./TitleBar";
import { Splitter } from "./Splitter";
import { SearchPalette } from "@/components/SearchPalette";

export interface MainWindowShellProps {
  onOpenSettings: () => void;
  settingsOpen?: boolean;
  // Rendered directly below the TitleBar so it clears the macOS traffic lights.
  banner?: ReactNode;
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

// Scroll a list section to the top of the ListPane.
//
// We can't use `element.scrollIntoView()` here: it scrolls *every* scrollable
// ancestor — including the window/body — to bring the element into view. The
// section headers live inside the ListPane, which starts below the TitleBar, so
// aligning a header to the top of the viewport drags the whole app upward. We
// instead scroll only the ListPane container by computing the header's offset
// within it.
function scrollSectionIntoView(section: string): void {
  const el = document.getElementById(`section-${section}`);
  if (!el) return;
  const container = el.closest<HTMLElement>('[aria-label="List"]');
  // No container, or a non-browser env (jsdom) that lacks Element.scrollTo:
  // fall back to scrollIntoView, which jsdom stubs as a no-op.
  if (!container || typeof container.scrollTo !== "function") {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const top =
    el.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop;
  container.scrollTo({ top, behavior: "smooth" });
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
  banner,
}: MainWindowShellProps) {
  const selectedItemId = useAppStore((s) => s.selectedItemId);
  const setSelectedItemId = useAppStore((s) => s.setSelectedItemId);
  const pendingNotificationItemId = useAppStore(
    (s) => s.pendingNotificationItemId,
  );
  const setPendingNotificationItemId = useAppStore(
    (s) => s.setPendingNotificationItemId,
  );
  const selected = useSelectedItem();
  const { reviewRequests, inFlight, standaloneRuns, recentlyResolved } =
    useActionableItems();
  const pollState = useAppStore((s) => s.pollState);
  const showAll = useAppStore(selectShowAllReviews);
  const [activeSection, setActiveSection] =
    useState<"reviews" | "inflight" | "runs" | "recent">("reviews");

  // When no item is currently resolved (either nothing selected, or the
  // stored id is a ghost), auto-pick the top-scored Review Request and
  // mirror it into the store so the row highlights. Skip while a notification
  // click is pending so it doesn't clobber that target before the data loads.
  useEffect(() => {
    if (selected) return;
    if (pendingNotificationItemId) return;
    const autoPick = pickAutoSelect(reviewRequests, showAll);
    const targetId = autoPick?.id ?? null;
    if (targetId !== selectedItemId) {
      setSelectedItemId(targetId);
    }
  }, [
    selected,
    pendingNotificationItemId,
    reviewRequests,
    showAll,
    selectedItemId,
    setSelectedItemId,
  ]);

  // Resolve a pending notification-click selection once its target appears in
  // the loaded data. On the warm path this is immediate; on cold start it
  // resolves after the first poll lands. Selects the item, reveals its section,
  // and clears the pending marker.
  useEffect(() => {
    if (!pendingNotificationItemId) return;
    const id = pendingNotificationItemId;
    const section = reviewRequests.some((it) => it.id === id)
      ? "reviews"
      : inFlight.some((it) => it.id === id)
        ? "inflight"
        : standaloneRuns.some((it) => it.id === id)
          ? "runs"
          : recentlyResolved.some((it) => it.id === id)
            ? "recent"
            : null;
    if (!section) {
      // Target not in the loaded data. While no poll has completed yet this is
      // the expected cold-start gap, so keep waiting. But once a poll cycle has
      // finished ("ok"/"error") and the item is still absent — it merged, was
      // untracked, or aged out — give up and clear the marker so auto-pick can
      // resume instead of the app sitting stuck in a pending state forever.
      if (pollState === "ok" || pollState === "error") {
        setPendingNotificationItemId(null);
      }
      return;
    }
    setSelectedItemId(id);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveSection(section);
    setPendingNotificationItemId(null);
    requestAnimationFrame(() => {
      scrollSectionIntoView(section);
    });
  }, [
    pendingNotificationItemId,
    pollState,
    reviewRequests,
    inFlight,
    standaloneRuns,
    recentlyResolved,
    setSelectedItemId,
    setPendingNotificationItemId,
  ]);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const searchButtonRef = useRef<HTMLButtonElement | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [detailWidth, setDetailWidth] = useState<number>(DETAIL_WIDTH_DEFAULT);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);

  // Global ⌘K toggles the search palette. Ignore when focus is in an unrelated
  // input/textarea so we don't hijack a user's keystrokes; the palette's own
  // input is exempt via the `[data-search-palette]` ancestor check.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cmdK =
        (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !e.altKey;
      if (!cmdK) return;
      const ae = document.activeElement as HTMLElement | null;
      const inForeignInput =
        !!ae &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.isContentEditable);
      const insidePalette = ae?.closest("[data-search-palette]") != null;
      if (inForeignInput && !insidePalette) return;
      e.preventDefault();
      setSearchOpen((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--color-bg)",
      }}
    >
      <TitleBar
        onOpenSettings={onOpenSettings}
        settingsOpen={settingsOpen}
        onOpenSearch={() => setSearchOpen(true)}
        searchButtonRef={searchButtonRef}
      />
      {banner}
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
            activeSection={activeSection}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={toggleSidebar}
            onSectionClick={(section) => {
              if (
                section !== "reviews" &&
                section !== "inflight" &&
                section !== "runs" &&
                section !== "recent"
              ) {
                return;
              }
              setActiveSection(section);
              scrollSectionIntoView(section);
            }}
          />
        </div>
        <div
          ref={gridRef}
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: `1fr 1px ${detailWidth}px`,
            // Constrain the single implicit row so it can shrink below its
            // content size — otherwise an `auto` row grows to fit ListPane /
            // DetailPane, their `overflow: auto` never engages, and the
            // content overflows up to the window body (whole-app scrollbar).
            gridTemplateRows: "minmax(0, 1fr)",
            minHeight: 0,
          }}
        >
          <ListPane />
          <Splitter onResize={onResize} />
          <DetailPane item={selected} />
        </div>
      </div>
      <SearchPalette
        open={searchOpen}
        onClose={() => {
          setSearchOpen(false);
          searchButtonRef.current?.focus();
        }}
      />
    </div>
  );
}
