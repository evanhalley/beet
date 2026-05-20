"use client";

import { useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  Maximize2,
  Pause,
  Play,
  RefreshCw,
  Settings as SettingsIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore, isReviewRequestVisible, selectShowAllReviews } from "@/lib/store";
import { openInBrowser } from "@/lib/openInBrowser";
import type { ActionableItem } from "@/lib/types";
import { BeetMark } from "./BeetMark";
import { PollingDot } from "./PollingDot";
import { Avatar } from "./Avatar";
import { Pill } from "./Pill";
import { ScoreBar } from "./ScoreBar";
import { CheckDot, deriveCheckDotState } from "./CheckDot";
import { Lifecycle } from "./Lifecycle";
import { TaskChips } from "./TaskChips";
import dayjs from "@/lib/dayjs";

interface SectionCollapse {
  needs: boolean;
  reviews: boolean;
  inflight: boolean;
  runs: boolean;
  recent: boolean;
}

const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 22,
  borderRadius: 5,
  background: "transparent",
  color: "var(--color-text-muted)",
  cursor: "pointer",
};

const footBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "3px 7px",
  borderRadius: 5,
  color: "var(--color-text-muted)",
  fontSize: 11.5,
  fontWeight: 500,
  background: "transparent",
  cursor: "pointer",
};

export function TrayPopover() {
  const reviewRequests = useAppStore((s) => s.reviewRequests);
  const inFlight = useAppStore((s) => s.inFlight);
  const standaloneRuns = useAppStore((s) => s.standaloneRuns);
  const recentlyResolved = useAppStore((s) => s.recentlyResolved);
  const paused = useAppStore((s) => s.paused);
  const setPaused = useAppStore((s) => s.setPaused);
  const showAll = useAppStore(selectShowAllReviews);

  const [collapsed, setCollapsed] = useState<SectionCollapse>({
    needs: false,
    reviews: false,
    inflight: false,
    runs: false,
    recent: true,
  });

  const toggle = (key: keyof SectionCollapse) =>
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  const visibleReviews = [...reviewRequests]
    .sort((a, b) => (b.pr?.score ?? 0) - (a.pr?.score ?? 0))
    .filter((it) => isReviewRequestVisible(it, showAll));

  const totalUnread =
    reviewRequests.filter((r) => r.unread).length;

  const beetStatus = paused ? "paused" as const : totalUnread > 0 ? "alert" as const : "ok" as const;

  const onRefresh = () => {
    void invoke("refresh_now").catch(() => {});
  };

  const onTogglePause = () => {
    const next = !paused;
    setPaused(next);
    void invoke("set_poll_paused", { paused: next }).catch(() => {});
  };

  const onOpenWindow = async () => {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const main = await WebviewWindow.getByLabel("main");
      if (main) {
        await main.show();
        await main.unminimize();
        await main.setFocus();
      }
    } catch {
      // No Tauri host
    }
  };

  return (
    <div
      style={{
        width: 360,
        height: 480,
        background: "var(--color-bg)",
        borderRadius: 12,
        boxShadow: "var(--shadow-lg, 0 18px 48px rgba(0,0,0,.18)), 0 0 0 0.5px var(--color-border-strong, var(--color-border))",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        fontSize: 12.5,
      }}
    >
      {/* Title bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-bg-elev)",
        }}
      >
        <BeetMark size={18} status={beetStatus} />
        <span style={{ fontWeight: 600, letterSpacing: -0.2, fontSize: 13 }}>
          Beet
        </span>
        {totalUnread > 0 && (
          <span
            className="mono"
            style={{
              background: "var(--color-accent)",
              color: "var(--color-accent-fg, #fff)",
              fontSize: 10,
              fontWeight: 600,
              padding: "1px 6px",
              borderRadius: 999,
              lineHeight: 1.5,
            }}
          >
            {totalUnread}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <PollingDot paused={paused} />
        <button
          type="button"
          onClick={onRefresh}
          disabled={paused}
          title="Refresh now"
          aria-label="Refresh now"
          style={{
            ...iconBtn,
            cursor: paused ? "default" : "pointer",
            opacity: paused ? 0.4 : 1,
          }}
        >
          <RefreshCw size={13} />
        </button>
        <button
          type="button"
          onClick={onOpenWindow}
          title="Open main window"
          aria-label="Open main window"
          style={iconBtn}
        >
          <Maximize2 size={13} />
        </button>
        <button
          type="button"
          onClick={onTogglePause}
          title={paused ? "Resume polling" : "Pause polling"}
          aria-label={paused ? "Resume polling" : "Pause polling"}
          style={iconBtn}
        >
          {paused ? <Play size={13} /> : <Pause size={13} />}
        </button>
      </div>

      {/* Scroll body */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Needs Action — placeholder until #8 */}
        <TraySection
          icon="🔴"
          title="Needs Action"
          count={0}
          collapsed={collapsed.needs}
          onToggle={() => toggle("needs")}
        >
          <p
            style={{
              padding: "6px 12px 10px",
              fontSize: 11.5,
              color: "var(--color-text-faint)",
            }}
          >
            No items needing action.
          </p>
        </TraySection>

        <TraySection
          icon="👀"
          title="Review Requests"
          count={visibleReviews.length}
          collapsed={collapsed.reviews}
          onToggle={() => toggle("reviews")}
        >
          {visibleReviews.length === 0 ? (
            <p
              style={{
                padding: "6px 12px 10px",
                fontSize: 11.5,
                color: "var(--color-text-faint)",
              }}
            >
              No review requests.
            </p>
          ) : (
            visibleReviews.map((item) => (
              <TrayReviewRow key={item.id} item={item} />
            ))
          )}
        </TraySection>

        <TraySection
          icon="🚀"
          title="In Flight"
          count={inFlight.length}
          collapsed={collapsed.inflight}
          onToggle={() => toggle("inflight")}
        >
          {inFlight.length === 0 ? (
            <p
              style={{
                padding: "6px 12px 10px",
                fontSize: 11.5,
                color: "var(--color-text-faint)",
              }}
            >
              No in-flight PRs.
            </p>
          ) : (
            inFlight.map((item) => (
              <TrayInflightRow key={item.id} item={item} />
            ))
          )}
        </TraySection>

        <TraySection
          icon="⚙️"
          title="Standalone Runs"
          count={standaloneRuns.length}
          collapsed={collapsed.runs}
          onToggle={() => toggle("runs")}
        >
          {standaloneRuns.length === 0 ? (
            <p
              style={{
                padding: "6px 12px 10px",
                fontSize: 11.5,
                color: "var(--color-text-faint)",
              }}
            >
              No standalone runs.
            </p>
          ) : (
            standaloneRuns.map((item) => (
              <TrayRunRow key={item.id} item={item} />
            ))
          )}
        </TraySection>

        <TraySection
          icon="✅"
          title="Recently Resolved"
          count={recentlyResolved.length}
          collapsed={collapsed.recent}
          onToggle={() => toggle("recent")}
          muted
        >
          {recentlyResolved.length === 0 ? (
            <p
              style={{
                padding: "6px 12px 10px",
                fontSize: 11.5,
                color: "var(--color-text-faint)",
              }}
            >
              Nothing resolved recently.
            </p>
          ) : (
            recentlyResolved.map((item) => (
              <TrayRecentRow key={item.id} item={item} />
            ))
          )}
        </TraySection>
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: "1px solid var(--color-border)",
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "var(--color-bg-elev)",
          fontSize: 11.5,
        }}
      >
        <button type="button" onClick={onOpenWindow} style={footBtn}>
          Open Beet
          <ExternalLink size={11} style={{ marginLeft: 4 }} />
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => {
            onOpenWindow();
          }}
          title="Settings"
          aria-label="Settings"
          style={footBtn}
        >
          <SettingsIcon size={13} />
        </button>
      </div>
    </div>
  );
}

// ─────────── Section ───────────

function TraySection({
  icon,
  title,
  count,
  collapsed,
  onToggle,
  children,
  muted,
}: {
  icon: string;
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 12px 6px",
          color: muted ? "var(--color-text-faint)" : "var(--color-text-muted)",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.04,
          textAlign: "left",
          background: "transparent",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            fontSize: 12,
            filter: muted ? "grayscale(0.4) opacity(0.7)" : "none",
          }}
        >
          {icon}
        </span>
        <span>{title}</span>
        <span
          className="mono"
          style={{
            fontSize: 10.5,
            fontWeight: 500,
            padding: "0 5px",
            borderRadius: 999,
            background: "var(--color-panel-2)",
            color: "var(--color-text-faint)",
            letterSpacing: 0,
          }}
        >
          {count}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            display: "inline-flex",
            color: "var(--color-text-faint)",
            transition: "transform .15s",
            transform: collapsed ? "rotate(-90deg)" : "rotate(0)",
          }}
        >
          <ChevronDown size={10} />
        </span>
      </button>
      {!collapsed && children}
    </section>
  );
}

// ─────────── Row base ───────────

const rowBase: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  gap: 10,
  padding: "var(--row-pad-y, 10px) 12px",
  alignItems: "center",
  borderTop: "1px solid var(--color-border)",
  cursor: "pointer",
};

function TrayRowWrapper({
  item,
  children,
}: {
  item: ActionableItem;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openInBrowser(item.url)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") openInBrowser(item.url);
      }}
      style={rowBase}
    >
      {children}
    </div>
  );
}

// ─────────── Row types ───────────

function TrayReviewRow({ item }: { item: ActionableItem }) {
  const pr = item.pr;
  if (!pr) return null;
  const checkState = deriveCheckDotState(
    pr.checkRuns?.[0]?.status,
    pr.checkRuns?.[0]?.conclusion,
  );

  return (
    <TrayRowWrapper item={item}>
      <Avatar login={pr.author} size={20} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 2,
          }}
        >
          <span
            className="mono"
            style={{ color: "var(--color-text-faint)", fontSize: 11 }}
          >
            {item.repoFullName}
          </span>
          <span
            className="mono"
            style={{ color: "var(--color-text-faint)", fontSize: 11 }}
          >
            #{pr.number}
          </span>
          {pr.isAuthorOnMyTeam && (
            <Pill tone="accent" soft>
              team
            </Pill>
          )}
          {pr.isDraft && (
            <Pill tone="neutral" soft>
              draft
            </Pill>
          )}
          {pr.taskUrls.length > 0 && (
            <TaskChips urls={pr.taskUrls} max={2} />
          )}
        </div>
        <div
          style={{
            fontWeight: item.unread ? 600 : 500,
            color: item.unread ? "var(--color-text)" : "var(--color-text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.title}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <ScoreBar score={pr.score} width={22} />
        <CheckDot state={checkState} />
      </div>
    </TrayRowWrapper>
  );
}

function TrayInflightRow({ item }: { item: ActionableItem }) {
  const pr = item.pr;
  if (!pr) return null;

  const checkState = deriveCheckDotState(
    pr.checkRuns?.[0]?.status,
    pr.checkRuns?.[0]?.conclusion,
  );

  return (
    <TrayRowWrapper item={item}>
      <UnreadDot unread={item.unread} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 2,
          }}
        >
          <span
            className="mono"
            style={{ color: "var(--color-text-faint)", fontSize: 11 }}
          >
            {item.repoFullName}
          </span>
          <span
            className="mono"
            style={{ color: "var(--color-text-faint)", fontSize: 11 }}
          >
            #{pr.number}
          </span>
          <Lifecycle
            state={pr.lifecycle}
            mqPos={pr.mergeQueue?.position}
          />
          {pr.taskUrls.length > 0 && (
            <TaskChips urls={pr.taskUrls} max={2} />
          )}
        </div>
        <div
          style={{
            color: "var(--color-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.title}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--color-text-faint)" }}>
          <span style={{ color: "var(--color-success)" }}>+{pr.additions}</span>
          {" "}
          <span style={{ color: "var(--color-danger)" }}>−{pr.deletions}</span>
        </span>
        <CheckDot state={checkState} />
      </div>
    </TrayRowWrapper>
  );
}

function TrayRunRow({ item }: { item: ActionableItem }) {
  const run = item.run;
  if (!run) return null;

  const dotState = deriveCheckDotState(run.status, run.conclusion);
  const spinning = run.status === "in_progress";

  return (
    <TrayRowWrapper item={item}>
      <span
        style={{
          color:
            run.conclusion === "failure"
              ? "var(--color-danger)"
              : spinning
                ? "var(--color-info)"
                : "var(--color-text-faint)",
          display: "inline-flex",
        }}
      >
        <RefreshCw
          size={12}
          style={{
            animation: spinning ? "beet-spin 1s linear infinite" : "none",
          }}
        />
      </span>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 2,
          }}
        >
          <span
            className="mono"
            style={{ color: "var(--color-text-faint)", fontSize: 11 }}
          >
            {item.repoFullName}
          </span>
          <span
            className="mono"
            style={{ color: "var(--color-text-faint)", fontSize: 11 }}
          >
            #{run.runNumber}
          </span>
        </div>
        <div className="mono" style={{ color: "var(--color-text)" }}>
          {run.workflowName}
        </div>
      </div>
      <CheckDot state={dotState} />
    </TrayRowWrapper>
  );
}

function TrayRecentRow({ item }: { item: ActionableItem }) {
  const pr = item.pr;
  const run = item.run;

  return (
    <TrayRowWrapper item={item}>
      <span style={{ color: "var(--color-success)", display: "inline-flex" }}>
        <svg
          width="11"
          height="11"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 8.5l3 3 7-7" />
        </svg>
      </span>
      <div style={{ minWidth: 0, opacity: 0.7 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 1,
          }}
        >
          <span
            className="mono"
            style={{ color: "var(--color-text-faint)", fontSize: 11 }}
          >
            {item.repoFullName}
          </span>
          {pr && (
            <span
              className="mono"
              style={{ color: "var(--color-text-faint)", fontSize: 11 }}
            >
              #{pr.number}
            </span>
          )}
        </div>
        <div
          style={{
            color: "var(--color-text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.title || run?.workflowName}
        </div>
      </div>
      <span
        className="mono"
        style={{ fontSize: 11, color: "var(--color-text-faint)", opacity: 0.7 }}
      >
        {dayjs(item.updatedAt).fromNow()}
      </span>
    </TrayRowWrapper>
  );
}

function UnreadDot({ unread }: { unread: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: 3,
        background: unread ? "var(--color-accent)" : "transparent",
        flexShrink: 0,
      }}
    />
  );
}
