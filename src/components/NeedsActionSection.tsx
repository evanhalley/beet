"use client";

import { useState } from "react";
import { ChevronDown, CircleAlert } from "lucide-react";
import { useActionableItems } from "@/hooks/useActionableItems";
import { ActionableRow } from "./ActionableRow";
import { SkeletonRows } from "./SkeletonRow";

// Needs Action Now (SPECS §5, #25): merge-queue ejections and failing checks
// on my PRs, plus unread @mentions / replies to my reviews. A derived view —
// every row also appears in its home section below. Danger-toned header per
// `ListGroup tone="danger"` in design/src/main-window.jsx.
export function NeedsActionSection() {
  const { needsAction: items, isLoading } = useActionableItems();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section aria-label="Needs Action" id="section-needs">
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
          color: "var(--color-danger)",
          background: "var(--color-danger-soft)",
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-controls="needs-action-list"
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
          <CircleAlert size={12} aria-hidden />
          <span>Needs Action</span>
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
      </header>
      {!collapsed && (
        <div id="needs-action-list">
          {isLoading && items.length === 0 ? (
            <SkeletonRows count={1} />
          ) : items.length === 0 ? (
            <p
              style={{
                padding: "10px 16px 14px",
                fontSize: 12,
                color: "var(--color-text-faint)",
              }}
            >
              Nothing needs you right now.
            </p>
          ) : (
            <ul
              role="list"
              style={{ listStyle: "none", margin: 0, padding: 0 }}
            >
              {items.map((item) => (
                <li role="listitem" key={item.id}>
                  <ActionableRow item={item} variant="needs" />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
