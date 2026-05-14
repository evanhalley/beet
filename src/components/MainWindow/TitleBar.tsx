"use client";

import { Pause, Play, RefreshCw, Search, Settings as SettingsIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BeetMark } from "@/components/BeetMark";
import { PollingDot } from "@/components/PollingDot";

export interface TitleBarProps {
  onOpenSettings: () => void;
  settingsOpen?: boolean;
}

const iconBtnBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  borderRadius: 5,
  background: "transparent",
  color: "var(--color-text-muted)",
  cursor: "pointer",
};

export function TitleBar({ onOpenSettings, settingsOpen = false }: TitleBarProps) {
  const queryClient = useQueryClient();
  const [paused, setPaused] = useState(false);

  const onRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["review-requests"] });
  };

  return (
    <div
      data-tauri-drag-region
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        // Fixed height + flex centering puts toolbar items on the same
        // y-axis as the macOS traffic-light buttons (which sit centered
        // around y≈20px from the window top). Left padding clears the
        // ~78px-wide traffic-light cluster.
        height: 38,
        padding: "0 14px 0 84px",
        background: "var(--color-bg-elev)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <BeetMark size={18} />
      <span style={{ fontWeight: 600, fontSize: 13, letterSpacing: -0.2 }}>Beet</span>
      <span style={{ flex: 1 }} />
      <div
        aria-hidden
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 8px",
          borderRadius: 7,
          background: "var(--color-panel-2)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text-faint)",
          fontSize: 11.5,
          minWidth: 220,
        }}
      >
        <Search size={12} />
        <span>Search PRs, runs, repos…</span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10, opacity: 0.6 }}>
          ⌘K
        </span>
      </div>
      <span style={{ flex: 1 }} />
      <PollingDot paused={paused} />
      <button
        type="button"
        onClick={onRefresh}
        aria-label="Refresh"
        style={iconBtnBase}
      >
        <RefreshCw size={14} />
      </button>
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        aria-label={paused ? "Resume polling" : "Pause polling"}
        aria-pressed={paused}
        style={iconBtnBase}
      >
        {paused ? <Play size={14} /> : <Pause size={14} />}
      </button>
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Open Settings"
        aria-pressed={settingsOpen}
        style={{
          ...iconBtnBase,
          background: settingsOpen ? "var(--color-accent-soft)" : "transparent",
          color: settingsOpen ? "var(--color-accent)" : "var(--color-text-muted)",
        }}
      >
        <SettingsIcon size={14} />
      </button>
    </div>
  );
}
