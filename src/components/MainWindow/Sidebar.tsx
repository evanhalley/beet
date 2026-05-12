"use client";

import type { ReactNode } from "react";
import { CheckCircle2, Eye, Filter, Pin, Rocket, Settings as Cog, VolumeX } from "lucide-react";
import { useAppStore } from "@/lib/store";

interface SidebarGroupProps {
  title: string;
  children: ReactNode;
}

function SidebarGroup({ title, children }: SidebarGroupProps) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.06,
          color: "var(--color-text-faint)",
          padding: "0 10px 4px",
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {children}
      </div>
    </div>
  );
}

interface SidebarItemProps {
  icon: ReactNode;
  label: string;
  badge?: number;
  active?: boolean;
  muted?: boolean;
  disabled?: boolean;
}

function SidebarItem({
  icon,
  label,
  badge,
  active = false,
  muted = false,
  disabled = false,
}: SidebarItemProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 10px",
        borderRadius: 6,
        background: active ? "var(--color-accent-soft)" : "transparent",
        color: active
          ? "var(--color-accent)"
          : muted
          ? "var(--color-text-faint)"
          : "var(--color-text)",
        fontSize: 12.5,
        fontWeight: active ? 600 : 500,
        width: "100%",
        textAlign: "left",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-flex",
          width: 14,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon}
      </span>
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {badge != null && (
        <span
          className="mono"
          style={{
            fontSize: 10.5,
            padding: "0 5px",
            borderRadius: 999,
            background: active ? "var(--color-accent)" : "var(--color-panel-2)",
            color: active ? "var(--color-accent-fg)" : "var(--color-text-faint)",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function RateLimitCard() {
  const rateLimit = useAppStore((s) => s.rateLimit);
  const remaining = rateLimit?.remaining ?? 0;
  const total = rateLimit?.limit ?? 5000;
  const pct = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 0;
  const resetIn =
    rateLimit?.reset != null ? formatResetIn(rateLimit.reset) : "—";

  return (
    <div
      aria-label="Rate limit"
      style={{
        margin: "4px 8px 0",
        padding: "8px 10px",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        background: "var(--color-bg-elev)",
        fontSize: 11,
        color: "var(--color-text-faint)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 4,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: "var(--color-success)",
          }}
        />
        <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>
          Rate limit
        </span>
        <span style={{ flex: 1 }} />
        <span className="mono">
          {rateLimit ? `${remaining}/${total}` : "—"}
        </span>
      </div>
      <div
        style={{
          height: 3,
          background: "var(--color-panel-2)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct * 100}%`,
            background: "var(--color-success)",
          }}
        />
      </div>
      <div style={{ marginTop: 4 }}>resets in {resetIn}</div>
    </div>
  );
}

function formatResetIn(resetEpochSec: number): string {
  const ms = resetEpochSec * 1000 - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

export interface SidebarProps {
  activeSection?: "needs" | "reviews" | "inflight" | "runs" | "recent";
}

export function Sidebar({ activeSection = "reviews" }: SidebarProps) {
  const reviewCount = useAppStore((s) => s.reviewRequests.length);
  const inFlightCount = useAppStore((s) => s.inFlight.length);
  const runsCount = useAppStore((s) => s.standaloneRuns.length);

  return (
    <div
      aria-label="Sidebar"
      style={{
        background: "var(--color-panel)",
        padding: "12px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        overflow: "auto",
      }}
    >
      <SidebarGroup title="Triage">
        <SidebarItem
          icon={<span aria-hidden>🔴</span>}
          label="Needs Action"
          active={activeSection === "needs"}
          disabled
        />
        <SidebarItem
          icon={<Eye size={12} />}
          label="Review Requests"
          badge={reviewCount}
          active={activeSection === "reviews"}
        />
        <SidebarItem
          icon={<Rocket size={12} />}
          label="In Flight"
          badge={inFlightCount}
          active={activeSection === "inflight"}
        />
        <SidebarItem
          icon={<Cog size={12} />}
          label="Standalone Runs"
          badge={runsCount}
          active={activeSection === "runs"}
        />
        <SidebarItem
          icon={<CheckCircle2 size={12} />}
          label="Recently Resolved"
          muted
          active={activeSection === "recent"}
        />
      </SidebarGroup>

      <SidebarGroup title="Filters">
        <SidebarItem icon={<Filter size={12} />} label="Failing only" disabled />
        <SidebarItem icon={<Filter size={12} />} label="Pending only" disabled />
        <SidebarItem
          icon={<span style={{ fontSize: 11, color: "var(--color-accent)" }}>★</span>}
          label="My team only"
          disabled
        />
      </SidebarGroup>

      <SidebarGroup title="Pinned">
        <SidebarItem icon={<Pin size={12} />} label="No pinned repos" muted disabled />
      </SidebarGroup>

      <SidebarGroup title="Muted">
        <SidebarItem icon={<VolumeX size={12} />} label="No muted repos" muted disabled />
      </SidebarGroup>

      <span style={{ flex: 1 }} />
      <RateLimitCard />
    </div>
  );
}
