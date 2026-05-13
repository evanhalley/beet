"use client";

import type { ReactNode } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Filter,
  Pin,
  Rocket,
  Settings as Cog,
  VolumeX,
} from "lucide-react";
import { useAppStore } from "@/lib/store";

interface SidebarGroupProps {
  title: string;
  collapsed?: boolean;
  action?: ReactNode;
  children: ReactNode;
}

function SidebarGroup({
  title,
  collapsed = false,
  action,
  children,
}: SidebarGroupProps) {
  const showHeader = !collapsed || action != null;
  return (
    <div>
      {showHeader && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.06,
            color: "var(--color-text-faint)",
            padding: collapsed ? "0 0 4px" : "0 4px 4px 10px",
            justifyContent: collapsed ? "center" : "flex-start",
            minHeight: 18,
          }}
        >
          {!collapsed && <span>{title}</span>}
          {!collapsed && <span style={{ flex: 1 }} />}
          {action}
        </div>
      )}
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
  collapsed?: boolean;
  current?: boolean;
}

function SidebarItem({
  icon,
  label,
  badge,
  active = false,
  muted = false,
  disabled = false,
  collapsed = false,
  current = false,
}: SidebarItemProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      aria-current={current ? "page" : undefined}
      aria-label={label}
      title={collapsed ? label : undefined}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: collapsed ? "6px 0" : "5px 10px",
        justifyContent: collapsed ? "center" : "flex-start",
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
      {!collapsed && (
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
      )}
      {badge != null && !collapsed && (
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
      {badge != null && collapsed && badge > 0 && (
        <span
          aria-hidden
          className="mono"
          style={{
            position: "absolute",
            top: 2,
            right: 4,
            fontSize: 9,
            lineHeight: 1,
            padding: "1px 4px",
            borderRadius: 999,
            background: "var(--color-accent)",
            color: "var(--color-accent-fg)",
            fontWeight: 600,
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function RateLimitCard({ collapsed = false }: { collapsed?: boolean }) {
  const rateLimit = useAppStore((s) => s.rateLimit);
  const remaining = rateLimit?.remaining ?? 0;
  const total = rateLimit?.limit ?? 5000;
  const pct = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 0;
  const resetIn =
    rateLimit?.reset != null ? formatResetIn(rateLimit.reset) : "—";

  if (collapsed) {
    return (
      <div
        aria-label="Rate limit"
        title={rateLimit ? `Rate limit ${remaining}/${total}` : "Rate limit"}
        style={{
          margin: "4px auto 0",
          width: 8,
          height: 8,
          borderRadius: 4,
          background: "var(--color-success)",
        }}
      />
    );
  }

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
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function Sidebar({
  activeSection = "reviews",
  collapsed = false,
  onToggleCollapsed,
}: SidebarProps) {
  const reviewCount = useAppStore((s) => s.reviewRequests.length);
  const inFlightCount = useAppStore((s) => s.inFlight.length);
  const runsCount = useAppStore((s) => s.standaloneRuns.length);

  const toggleButton = onToggleCollapsed ? (
    <button
      type="button"
      onClick={onToggleCollapsed}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-pressed={collapsed}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        borderRadius: 4,
        background: "transparent",
        color: "var(--color-text-muted)",
        cursor: "pointer",
      }}
    >
      {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
    </button>
  ) : undefined;

  return (
    <div
      aria-label="Sidebar"
      style={{
        flex: 1,
        minHeight: 0,
        background: "var(--color-panel)",
        padding: collapsed ? "10px 4px" : "12px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        overflow: "auto",
      }}
    >
      {/*
        Sidebar navigation isn't wired yet — inactive Triage items are
        disabled so they don't read as clickable to users or assistive
        tech. The active item gets aria-current="page".
      */}
      <SidebarGroup title="Triage" collapsed={collapsed} action={toggleButton}>
        <SidebarItem
          icon={<span aria-hidden>🔴</span>}
          label="Needs Action"
          active={activeSection === "needs"}
          current={activeSection === "needs"}
          collapsed={collapsed}
          disabled
        />
        <SidebarItem
          icon={<Eye size={12} />}
          label="Review Requests"
          badge={reviewCount}
          active={activeSection === "reviews"}
          current={activeSection === "reviews"}
          collapsed={collapsed}
          disabled={activeSection !== "reviews"}
        />
        <SidebarItem
          icon={<Rocket size={12} />}
          label="In Flight"
          badge={inFlightCount}
          active={activeSection === "inflight"}
          current={activeSection === "inflight"}
          collapsed={collapsed}
          disabled={activeSection !== "inflight"}
        />
        <SidebarItem
          icon={<Cog size={12} />}
          label="Standalone Runs"
          badge={runsCount}
          active={activeSection === "runs"}
          current={activeSection === "runs"}
          collapsed={collapsed}
          disabled={activeSection !== "runs"}
        />
        <SidebarItem
          icon={<CheckCircle2 size={12} />}
          label="Recently Resolved"
          muted
          active={activeSection === "recent"}
          current={activeSection === "recent"}
          collapsed={collapsed}
          disabled={activeSection !== "recent"}
        />
      </SidebarGroup>

      {!collapsed && (
        <>
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
        </>
      )}

      <span style={{ flex: 1 }} />
      <RateLimitCard collapsed={collapsed} />
    </div>
  );
}
