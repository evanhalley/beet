"use client";

import { RefreshCw } from "lucide-react";
import { useAppStore } from "@/lib/store";

export interface PollingDotProps {
  paused?: boolean;
  label?: string;
}

export function PollingDot({ paused = false, label }: PollingDotProps) {
  // The Rust poll loop reports its state via the `poll:status` event, which
  // usePollEvents funnels into the store; "polling" = a cycle is in flight.
  const fetching = useAppStore((s) => s.pollState) === "polling";
  const spinning = !paused && fetching;
  const display = paused ? "paused" : label ?? (spinning ? "syncing" : "idle");
  const color = paused ? "var(--color-warn)" : "var(--color-text-muted)";

  return (
    <span
      aria-label={paused ? "Polling paused" : spinning ? "Polling" : "Idle"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color,
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-flex",
          width: 14,
          height: 14,
          alignItems: "center",
          justifyContent: "center",
          color: paused ? "var(--color-warn)" : "var(--color-text-faint)",
          animation: spinning ? "beet-spin .9s linear infinite" : "none",
        }}
      >
        {paused ? (
          <span
            style={{
              width: 8,
              height: 8,
              border: "2px solid currentColor",
              borderRadius: 1,
            }}
          />
        ) : (
          <RefreshCw size={12} />
        )}
      </span>
      <span className="mono" style={{ fontSize: 11 }}>
        {display}
      </span>
    </span>
  );
}
