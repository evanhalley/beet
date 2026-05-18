"use client";

import type { Ref } from "react";
import { Pause, Play, RefreshCw, Search, Settings as SettingsIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { BeetMark } from "@/components/BeetMark";
import { PollingDot } from "@/components/PollingDot";
import { useAppStore } from "@/lib/store";

export interface TitleBarProps {
  onOpenSettings: () => void;
  settingsOpen?: boolean;
  onOpenSearch?: () => void;
  searchButtonRef?: Ref<HTMLButtonElement>;
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

export function TitleBar({
  onOpenSettings,
  settingsOpen = false,
  onOpenSearch,
  searchButtonRef,
}: TitleBarProps) {
  const paused = useAppStore((s) => s.paused);
  const setPaused = useAppStore((s) => s.setPaused);

  // Refresh / pause drive the Rust poll loop. Best-effort: a no-op in
  // Tauri-less / test environments.
  const onRefresh = () => {
    void invoke("refresh_now").catch(() => {});
  };

  const onTogglePause = () => {
    const next = !paused;
    setPaused(next);
    void invoke("set_poll_paused", { paused: next }).catch(() => {});
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
      <button
        ref={searchButtonRef}
        type="button"
        onClick={() => onOpenSearch?.()}
        aria-label="Search"
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
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <Search size={12} />
        <span>Search PRs, runs, repos…</span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10, opacity: 0.6 }}>
          ⌘K
        </span>
      </button>
      <span style={{ flex: 1 }} />
      <PollingDot paused={paused} />
      <button
        type="button"
        onClick={onRefresh}
        disabled={paused}
        aria-label="Refresh"
        style={{
          ...iconBtnBase,
          cursor: paused ? "default" : "pointer",
          opacity: paused ? 0.4 : 1,
        }}
      >
        <RefreshCw size={14} />
      </button>
      <button
        type="button"
        onClick={onTogglePause}
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
