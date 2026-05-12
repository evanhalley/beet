"use client";

import { ExternalLink } from "lucide-react";
import { Pill } from "@/components/Pill";
import { ScoreBar } from "@/components/ScoreBar";
import { openInBrowser } from "@/lib/openInBrowser";
import type { ActionableItem } from "@/lib/types";

export interface DetailPaneProps {
  item: ActionableItem | null;
}

function PlaceholderBlock({ title, hint }: { title: string; hint: string }) {
  return (
    <section
      aria-label={title}
      style={{
        padding: "10px 16px",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.06,
          color: "var(--color-text-faint)",
        }}
      >
        {title}
      </div>
      <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--color-text-faint)" }}>
        {hint}
      </div>
    </section>
  );
}

export function DetailPane({ item }: DetailPaneProps) {
  if (!item || !item.pr) {
    return (
      <div
        aria-label="Detail"
        style={{
          background: "var(--color-bg-elev)",
          borderLeft: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-text-faint)",
          fontSize: 12,
        }}
      >
        Select an item.
      </div>
    );
  }

  const pr = item.pr;

  return (
    <div
      aria-label="Detail"
      style={{
        background: "var(--color-bg-elev)",
        borderLeft: "1px solid var(--color-border)",
        overflow: "auto",
      }}
    >
      <header style={{ padding: "14px 16px 12px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "var(--color-text-faint)",
          }}
        >
          <span className="mono">{item.repoFullName}</span>
          <span className="mono">#{pr.number}</span>
          <span className="mono" style={{ color: "var(--color-text-faint)" }}>
            {/* Branch placeholder — fetched in #5. */}
            branch
          </span>
        </div>
        <h2
          style={{
            margin: "6px 0 8px",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--color-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.title}
        </h2>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {/* Lifecycle slot — full enum lands in #5. */}
          <Pill tone="neutral">open</Pill>
          <ScoreBar score={pr.score} width={36} />
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => void openInBrowser(item.url)}
            aria-label={`Open ${item.title} on GitHub`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 11.5,
              fontWeight: 500,
              background: "var(--color-accent)",
              color: "var(--color-accent-fg)",
              border: "1px solid var(--color-accent)",
              cursor: "pointer",
            }}
          >
            <ExternalLink size={12} />
            Open on GitHub
          </button>
        </div>
      </header>

      <PlaceholderBlock title="Body" hint="lands in #5" />
      <PlaceholderBlock title="Reviewers" hint="lands in #6" />
      <PlaceholderBlock title="Checks" hint="lands in #6" />
      <PlaceholderBlock title="Activity" hint="lands in #8" />
    </div>
  );
}
