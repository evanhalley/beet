"use client";

import type { ReactNode } from "react";
import { ReviewRequestsSection } from "@/components/ReviewRequestsSection";

interface EmptySectionProps {
  title: string;
  icon: ReactNode;
  hint: string;
}

function EmptySection({ title, icon, hint }: EmptySectionProps) {
  return (
    <section aria-label={title}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px 8px",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.06,
          color: "var(--color-text-faint)",
        }}
      >
        <span aria-hidden style={{ display: "inline-flex" }}>{icon}</span>
        <span>{title}</span>
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
          0
        </span>
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
          {hint}
        </span>
      </div>
    </section>
  );
}

export function ListPane() {
  return (
    <div
      aria-label="List"
      style={{
        borderLeft: "1px solid var(--color-border)",
        overflow: "auto",
        background: "var(--color-bg)",
      }}
    >
      <ReviewRequestsSection />
      <EmptySection title="In Flight" icon="🚀" hint="lands in #5" />
      <EmptySection title="Standalone Runs" icon="⚙️" hint="lands in #6" />
      <EmptySection title="Recently Resolved" icon="✅" hint="lands in #6" />
    </div>
  );
}
