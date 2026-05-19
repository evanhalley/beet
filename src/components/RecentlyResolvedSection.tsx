"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { useActionableItems } from "@/hooks/useActionableItems";
import type { ActionableItem } from "@/lib/types";
import { ActionableRow } from "./ActionableRow";
import { RunRow } from "./RunRow";

// Recently Resolved is a mixed-kind list (PRs + standalone runs). Dispatch
// on `kind` so each item picks the row component built for its shape.
function ResolvedRow({ item }: { item: ActionableItem }) {
  if (item.kind === "pr") {
    return <ActionableRow item={item} variant="inflight" />;
  }
  return <RunRow item={item} />;
}

export function RecentlyResolvedSection() {
  const { recentlyResolved: items } = useActionableItems();
  // Collapsed by default per SPECS §5 — this section is reference, not
  // primary action surface.
  const [collapsed, setCollapsed] = useState(true);

  return (
    <section aria-label="Recently Resolved" id="section-recent">
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
          aria-controls="recently-resolved-list"
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
          <CheckCircle2 size={12} aria-hidden />
          <span>Recently Resolved</span>
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
            {items.length}
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
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 500,
            textTransform: "none",
            letterSpacing: 0,
            color: "var(--color-text-faint)",
          }}
        >
          last 24h
        </span>
      </header>
      {!collapsed && (
        <div id="recently-resolved-list">
          {items.length === 0 ? (
            <p
              style={{
                padding: "10px 16px 14px",
                fontSize: 12,
                color: "var(--color-text-faint)",
              }}
            >
              Nothing resolved in the last 24 hours.
            </p>
          ) : (
            <ul role="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {items.map((item) => (
                <li role="listitem" key={item.id}>
                  <ResolvedRow item={item} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
