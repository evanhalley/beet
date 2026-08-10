"use client";

import { useState } from "react";
import { ChevronDown, Eye } from "lucide-react";
import {
  isReviewRequestVisible,
  selectShowAllReviews,
  useAppStore,
} from "@/lib/store";
import { hasActiveListFilter } from "@/lib/filters";
import { useActionableItems } from "@/hooks/useActionableItems";
import { ActionableRow } from "./ActionableRow";
import { SkeletonRows } from "./SkeletonRow";

export function ReviewRequestsSection() {
  const { reviewRequests: items, isLoading } = useActionableItems();
  const showAll = useAppStore(selectShowAllReviews);
  const suppressedIds = useAppStore((s) => s.suppressedIds);
  const snoozes = useAppStore((s) => s.snoozes);
  const override = useAppStore((s) => s.showAllReviewsOverride);
  const setOverride = useAppStore((s) => s.setShowAllReviewsOverride);
  const filtersActive = useAppStore((s) => hasActiveListFilter(s.listFilters, s.settings.teams.length > 0));
  const [collapsed, setCollapsed] = useState(false);

  // Rust scores every review-request item but never filters; visibility is a
  // frontend concern. "Show all" (session override or the persisted default)
  // reveals approved / zero-or-negative-score items.
  const sorted = [...items].sort(
    (a, b) => (b.pr?.score ?? 0) - (a.pr?.score ?? 0),
  );
  const visible = sorted.filter((it) =>
    isReviewRequestVisible(it, showAll, suppressedIds, snoozes),
  );

  return (
    <section aria-label="Review Requests" id="section-reviews">
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px 8px",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.06,
          color: "var(--color-text-muted)",
          background: "var(--color-panel-2)",
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-controls="review-requests-list"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            color: "inherit",
            background: "transparent",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <Eye size={12} aria-hidden />
          <span>Review Requests</span>
          <span
            className="mono"
            style={{
              fontSize: 10.5,
              padding: "0 5px",
              borderRadius: 999,
              background: "var(--color-panel-2)",
              color: "var(--color-text-faint)",
            }}
          >
            {visible.length}
          </span>
          <span
            style={{
              display: "inline-flex",
              color: "var(--color-text-faint)",
              transform: collapsed ? "rotate(-90deg)" : "rotate(0)",
              transition: "transform .15s",
            }}
          >
            <ChevronDown size={12} />
          </span>
        </button>
        <span style={{ flex: 1 }} />
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10.5,
            fontWeight: 500,
            textTransform: "none",
            letterSpacing: 0,
            color: "var(--color-text-muted)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setOverride(e.target.checked)}
            aria-label="Show All review requests, including approved"
          />
          Show all
        </label>
        {override !== null && (
          <button
            type="button"
            onClick={() => setOverride(null)}
            style={{
              fontSize: 10.5,
              fontWeight: 500,
              textTransform: "none",
              letterSpacing: 0,
              color: "var(--color-accent)",
              background: "transparent",
              cursor: "pointer",
              padding: 0,
              marginLeft: 6,
              textDecoration: "underline",
            }}
            aria-label="Reset Show All to default from Settings"
          >
            use default
          </button>
        )}
      </header>
      {!collapsed && (
        <div id="review-requests-list">
          {isLoading && visible.length === 0 ? (
            <SkeletonRows count={3} />
          ) : visible.length === 0 ? (
            <p
              style={{
                padding: "10px 16px 14px",
                fontSize: 12,
                color: "var(--color-text-faint)",
              }}
            >
              {filtersActive
                ? "No review requests match the active filters."
                : "No review requests right now."}
            </p>
          ) : (
            <ul
              role="list"
              style={{ listStyle: "none", margin: 0, padding: 0 }}
            >
              {visible.map((item) => (
                <li role="listitem" key={item.id}>
                  <ActionableRow item={item} variant="review" />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
