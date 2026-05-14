"use client";

import type { ReactNode } from "react";

export interface RowShellProps {
  ariaLabel: string;
  unread: boolean;
  active?: boolean;
  onSelect: () => void;
  children: ReactNode;
  aside?: ReactNode;
  /**
   * Interactive controls (e.g. a copy-link button) overlaid in the row's
   * top-right corner. Rendered as a sibling of the select button — not
   * nested inside it — so they can be real <button>s without invalid
   * button-in-button nesting.
   */
  actions?: ReactNode;
}

export function RowShell({
  ariaLabel,
  unread,
  active = false,
  onSelect,
  children,
  aside,
  actions,
}: RowShellProps) {
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={onSelect}
        aria-label={ariaLabel}
        aria-pressed={active}
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          gap: 10,
          alignItems: "center",
          padding: active ? "10px 16px 10px 14px" : "10px 16px",
          background: active ? "var(--color-accent-soft)" : "transparent",
          borderTop: "1px solid var(--color-border)",
          borderLeft: active
            ? "2px solid var(--color-accent)"
            : "2px solid transparent",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: 3,
            background: unread ? "var(--color-accent)" : "transparent",
          }}
        />
        <div style={{ minWidth: 0 }}>{children}</div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 5,
          }}
        >
          {aside}
        </div>
      </button>
      {actions && (
        <div
          style={{
            position: "absolute",
            top: 6,
            right: 12,
            display: "flex",
            gap: 4,
          }}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
