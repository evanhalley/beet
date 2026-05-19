"use client";

import { useState } from "react";
import { ChevronDown, Cog } from "lucide-react";
import { useActionableItems } from "@/hooks/useActionableItems";
import { RunRow } from "./RunRow";
import { SkeletonRows } from "./SkeletonRow";

export function StandaloneRunsSection() {
  const { standaloneRuns: items, isLoading } = useActionableItems();
  const [collapsed, setCollapsed] = useState(false);

  // Newest first by completion / update time. Stable sort preserves the order
  // the poller delivered for ties.
  const sorted = [...items].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );

  return (
    <section aria-label="Standalone Runs" id="section-runs">
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
          aria-controls="standalone-runs-list"
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
          <Cog size={12} aria-hidden />
          <span>Standalone Runs</span>
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
            {sorted.length}
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
      </header>
      {!collapsed && (
        <div id="standalone-runs-list">
          {isLoading && sorted.length === 0 ? (
            <SkeletonRows count={2} />
          ) : sorted.length === 0 ? (
            <p
              style={{
                padding: "10px 16px 14px",
                fontSize: 12,
                color: "var(--color-text-faint)",
              }}
            >
              No standalone workflow runs right now.
            </p>
          ) : (
            <ul role="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {sorted.map((item) => (
                <li role="listitem" key={item.id}>
                  <RunRow item={item} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
