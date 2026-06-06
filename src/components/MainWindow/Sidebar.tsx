"use client";

import { useState, type ReactNode } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Eye,
  Pin,
  Rocket,
  Settings as Cog,
  VolumeX,
  X,
} from "lucide-react";
import {
  isReviewRequestVisible,
  selectShowAllReviews,
  useAppStore,
} from "@/lib/store";
import { hasActiveListFilter } from "@/lib/filters";
import { useActionableItems } from "@/hooks/useActionableItems";
import { removeMute, removePin } from "@/lib/storage/mutePin";
import { CheckDot } from "@/components/CheckDot";

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
  // Native tooltip shown in both states. When collapsed, `label` is used as a
  // fallback so the icon-only rail stays legible.
  title?: string;
  onClick?: () => void;
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
  title,
  onClick,
}: SidebarItemProps) {
  const [hover, setHover] = useState(false);
  // Resting items light up on hover with the same token the pinned/muted rows
  // use; active items keep their accent fill and disabled items stay inert.
  const showHover = hover && !disabled && !active;
  const background = active
    ? "var(--color-accent-soft)"
    : showHover
    ? "var(--color-hover)"
    : "transparent";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-pressed={active}
      aria-current={current ? "page" : undefined}
      aria-label={label}
      title={title ?? (collapsed ? label : undefined)}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: collapsed ? "6px 0" : "5px 10px",
        justifyContent: collapsed ? "center" : "flex-start",
        borderRadius: 6,
        background,
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

interface RemovableSidebarRowProps {
  // The resting icon (a Pin / VolumeX glyph). Swapped for an ✕ on row hover.
  icon: ReactNode;
  label: string;
  // aria-label / tooltip for the remove button, e.g. "Unpin acme/repo".
  removeLabel: string;
  collapsed?: boolean;
  onRemove: () => void;
}

// A pinned/muted repo row. The leading icon turns into an ✕ while the row is
// hovered; clicking that icon — and only that icon — removes the rule. The
// repo name is plain text, not a click target, so removal is deliberate.
//
// Collapsed: the row drops to an icon-only button on the narrow rail. The
// resting glyph still flips to ✕ on hover, and the tooltip carries the repo
// name + action ("Unpin acme/repo") so removal stays discoverable without text.
function RemovableSidebarRow({
  icon,
  label,
  removeLabel,
  collapsed = false,
  onRemove,
}: RemovableSidebarRowProps) {
  const [rowHover, setRowHover] = useState(false);
  const [iconHover, setIconHover] = useState(false);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onRemove}
        onMouseEnter={() => {
          setRowHover(true);
          setIconHover(true);
        }}
        onMouseLeave={() => {
          setRowHover(false);
          setIconHover(false);
        }}
        aria-label={removeLabel}
        title={removeLabel}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          padding: "6px 0",
          borderRadius: 6,
          background: rowHover ? "var(--color-hover)" : "transparent",
          color: iconHover
            ? "var(--color-danger)"
            : "var(--color-text-faint)",
          cursor: "pointer",
        }}
      >
        {rowHover ? <X size={12} /> : icon}
      </button>
    );
  }

  return (
    <div
      onMouseEnter={() => setRowHover(true)}
      onMouseLeave={() => {
        setRowHover(false);
        setIconHover(false);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 10px",
        borderRadius: 6,
        background: rowHover ? "var(--color-hover)" : "transparent",
        fontSize: 12.5,
        fontWeight: 500,
        color: "var(--color-text)",
      }}
    >
      <button
        type="button"
        onClick={onRemove}
        onMouseEnter={() => setIconHover(true)}
        onMouseLeave={() => setIconHover(false)}
        aria-label={removeLabel}
        title={removeLabel}
        style={{
          display: "inline-flex",
          width: 14,
          height: 14,
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          background: "transparent",
          color: iconHover
            ? "var(--color-danger)"
            : "var(--color-text-faint)",
          cursor: "pointer",
        }}
      >
        {rowHover ? <X size={12} /> : icon}
      </button>
      <span
        // Native tooltip — surfaces the full name when the row is too narrow
        // to show it and the text is truncated with an ellipsis.
        title={label}
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </div>
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

export type SidebarSection =
  | "needs"
  | "reviews"
  | "inflight"
  | "runs"
  | "recent";

export interface SidebarProps {
  activeSection?: SidebarSection;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onSectionClick?: (section: SidebarSection) => void;
}

export function Sidebar({
  activeSection = "reviews",
  collapsed = false,
  onToggleCollapsed,
  onSectionClick,
}: SidebarProps) {
  const { reviewRequests, inFlight, standaloneRuns } = useActionableItems();
  const showAll = useAppStore(selectShowAllReviews);
  const mutes = useAppStore((s) => s.mutes);
  const pins = useAppStore((s) => s.pins);
  const setMutes = useAppStore((s) => s.setMutes);
  const setPins = useAppStore((s) => s.setPins);
  const listFilters = useAppStore((s) => s.listFilters);
  const toggleListFilter = useAppStore((s) => s.toggleListFilter);
  const clearListFilters = useAppStore((s) => s.clearListFilters);
  const teamsConfigured = useAppStore((s) => s.settings.teams.length > 0);

  // reviewRequests/inFlight/standaloneRuns from useActionableItems already have
  // mutes applied — no need to filter again here.
  const reviewCount = reviewRequests.filter((it) =>
    isReviewRequestVisible(it, showAll),
  ).length;
  const inFlightCount = inFlight.length;
  const runsCount = standaloneRuns.length;

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
          icon={<CircleAlert size={12} />}
          label="Needs Action"
          title="Urgent items needing you now: merge-queue ejections, failing checks on your PRs, and unread mentions or replies to your reviews"
          active={activeSection === "needs"}
          current={activeSection === "needs"}
          collapsed={collapsed}
          disabled
        />
        <SidebarItem
          icon={<Eye size={12} />}
          label="Review Requests"
          title="Open PRs where you're a requested reviewer and haven't approved yet"
          badge={reviewCount}
          active={activeSection === "reviews"}
          current={activeSection === "reviews"}
          collapsed={collapsed}
          onClick={() => onSectionClick?.("reviews")}
        />
        <SidebarItem
          icon={<Rocket size={12} />}
          label="In Flight"
          title="Your authored PRs that are open, in review, or in the merge queue"
          badge={inFlightCount}
          active={activeSection === "inflight"}
          current={activeSection === "inflight"}
          collapsed={collapsed}
          onClick={() => onSectionClick?.("inflight")}
        />
        <SidebarItem
          icon={<Cog size={12} />}
          label="Standalone Runs"
          title="Workflow runs you triggered with no PR — deploys, manual dispatches, and scheduled runs"
          badge={runsCount}
          active={activeSection === "runs"}
          current={activeSection === "runs"}
          collapsed={collapsed}
          onClick={() => onSectionClick?.("runs")}
        />
        <SidebarItem
          icon={<CheckCircle2 size={12} />}
          label="Recently Resolved"
          title="Merged PRs and completed runs from the last 24 hours"
          active={activeSection === "recent"}
          current={activeSection === "recent"}
          collapsed={collapsed}
          onClick={() => onSectionClick?.("recent")}
        />
      </SidebarGroup>

      <SidebarGroup
        title="Filters"
        collapsed={collapsed}
        action={
          !collapsed && hasActiveListFilter(listFilters) ? (
            <button
              type="button"
              onClick={clearListFilters}
              aria-label="Clear filters"
              title="Clear filters"
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: "none",
                letterSpacing: 0,
                color: "var(--color-accent)",
                background: "transparent",
                cursor: "pointer",
                padding: 0,
              }}
            >
              Clear
            </button>
          ) : undefined
        }
      >
        <SidebarItem
          icon={<CheckDot state="failure" />}
          label="Failing only"
          active={listFilters.failingOnly}
          collapsed={collapsed}
          onClick={() => toggleListFilter("failingOnly")}
        />
        <SidebarItem
          icon={<CheckDot state="pending" />}
          label="Pending only"
          active={listFilters.pendingOnly}
          collapsed={collapsed}
          onClick={() => toggleListFilter("pendingOnly")}
        />
        <SidebarItem
          icon={
            <span style={{ fontSize: 11, color: "var(--color-accent)" }}>★</span>
          }
          label="My team only"
          active={teamsConfigured && listFilters.myTeamOnly}
          disabled={!teamsConfigured}
          collapsed={collapsed}
          title={
            teamsConfigured
              ? undefined
              : "Add teams in Settings → Account to use this filter"
          }
          onClick={() => toggleListFilter("myTeamOnly")}
        />
      </SidebarGroup>

      <SidebarGroup title="Pinned" collapsed={collapsed}>
        {pins.length === 0 ? (
          <SidebarItem
            icon={<Pin size={12} />}
            label="No pinned repos"
            muted
            disabled
            collapsed={collapsed}
          />
        ) : (
          pins.map((repo) => (
            <RemovableSidebarRow
              key={repo}
              icon={<Pin size={12} />}
              label={repo}
              removeLabel={`Unpin ${repo}`}
              collapsed={collapsed}
              onRemove={async () => {
                try {
                  await removePin(repo);
                  setPins(useAppStore.getState().pins.filter((p) => p !== repo));
                } catch { /* storage error — leave state unchanged */ }
              }}
            />
          ))
        )}
      </SidebarGroup>

      <SidebarGroup title="Muted" collapsed={collapsed}>
        {mutes.length === 0 ? (
          <SidebarItem
            icon={<VolumeX size={12} />}
            label="No muted repos"
            muted
            disabled
            collapsed={collapsed}
          />
        ) : (
          mutes.map((rule) => (
            <RemovableSidebarRow
              key={`${rule.scope}:${rule.value}`}
              icon={<VolumeX size={12} />}
              label={rule.value}
              removeLabel={`Unmute ${rule.value}`}
              collapsed={collapsed}
              onRemove={async () => {
                try {
                  await removeMute(rule.scope, rule.value);
                  setMutes(
                    useAppStore.getState().mutes.filter(
                      (m) =>
                        !(m.scope === rule.scope && m.value === rule.value),
                    ),
                  );
                } catch { /* storage error — leave state unchanged */ }
              }}
            />
          ))
        )}
      </SidebarGroup>

      <span style={{ flex: 1 }} />
      <RateLimitCard collapsed={collapsed} />
    </div>
  );
}
