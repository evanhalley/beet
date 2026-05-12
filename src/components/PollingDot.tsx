"use client";

import { RefreshCw } from "lucide-react";
import { useIsFetching } from "@tanstack/react-query";

export interface PollingDotProps {
  paused?: boolean;
  label?: string;
}

export function PollingDot({ paused = false, label }: PollingDotProps) {
  const fetching = useIsFetching({ queryKey: ["review-requests"] }) > 0;
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
