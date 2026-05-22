"use client";

import { useState, type MouseEvent } from "react";
import { AlertTriangle, Check, Link2 } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { addMute, addPin, removePin } from "@/lib/storage/mutePin";
import { copyToClipboard } from "@/lib/copyToClipboard";
import type { ActionableItem } from "@/lib/types";
import { Avatar } from "./Avatar";
import { Lifecycle } from "./Lifecycle";
import { Pill } from "./Pill";
import { PinGlyph } from "./PinGlyph";
import { ReasonBadge } from "./ReasonBadge";
import { RowContextMenu } from "./RowContextMenu";
import { RowShell } from "./RowShell";
import { ScoreBar } from "./ScoreBar";
import { TaskChips } from "./TaskChips";

export type ActionableRowVariant = "review" | "inflight";

export interface ActionableRowProps {
  item: ActionableItem;
  variant?: ActionableRowVariant;
}

export function ActionableRow({ item, variant = "review" }: ActionableRowProps) {
  const pr = item.pr;
  const active = useAppStore((s) => s.selectedItemId === item.id);
  const setSelectedItemId = useAppStore((s) => s.setSelectedItemId);
  const pins = useAppStore((s) => s.pins);
  const setMutes = useAppStore((s) => s.setMutes);
  const setPins = useAppStore((s) => s.setPins);
  const mutes = useAppStore((s) => s.mutes);
  const [copied, setCopied] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  if (!pr) return null;

  const isPinned = pins.includes(item.repoFullName);
  const wasEjected = (pr.mergeQueue?.ejectedChecks?.length ?? 0) > 0;

  const aside =
    variant === "review" ? <ScoreBar score={pr.score} width={26} /> : null;

  const onCopy = async (e: MouseEvent) => {
    e.stopPropagation();
    const ok = await copyToClipboard(item.url);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const handleMuteRepo = async () => {
    if (mutes.some((m) => m.scope === "repo" && m.value === item.repoFullName)) return;
    try {
      await addMute("repo", item.repoFullName);
      // Read fresh state after the await — the closure's `mutes` may be stale
      // if another handler ran concurrently while the IPC call was in-flight.
      const latest = useAppStore.getState().mutes;
      if (!latest.some((m) => m.scope === "repo" && m.value === item.repoFullName)) {
        setMutes([...latest, { scope: "repo" as const, value: item.repoFullName }]);
      }
    } catch { /* storage error — leave state unchanged */ }
  };

  const handleMuteOrg = async () => {
    const owner = item.repoFullName.split("/")[0] ?? "";
    if (mutes.some((m) => m.scope === "org" && m.value === owner)) return;
    try {
      await addMute("org", owner);
      const latest = useAppStore.getState().mutes;
      if (!latest.some((m) => m.scope === "org" && m.value === owner)) {
        setMutes([...latest, { scope: "org" as const, value: owner }]);
      }
    } catch { /* storage error — leave state unchanged */ }
  };

  const handleTogglePin = async () => {
    try {
      if (isPinned) {
        await removePin(item.repoFullName);
        const latest = useAppStore.getState().pins;
        setPins(latest.filter((p) => p !== item.repoFullName));
      } else {
        await addPin(item.repoFullName);
        const latest = useAppStore.getState().pins;
        if (!latest.includes(item.repoFullName)) {
          setPins([...latest, item.repoFullName]);
        }
      }
    } catch { /* storage error — leave state unchanged */ }
  };

  const copyButton = (
    <button
      type="button"
      onClick={onCopy}
      aria-label={`Copy link to ${item.title}`}
      title={copied ? "Copied!" : "Copy PR URL"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: 5,
        background: copied ? "var(--color-success-soft)" : "transparent",
        color: copied ? "var(--color-success)" : "var(--color-text-faint)",
        cursor: "pointer",
      }}
    >
      {copied ? <Check size={13} /> : <Link2 size={13} />}
    </button>
  );

  return (
    <>
      <RowShell
        ariaLabel={`Select ${item.title}`}
        unread={item.unread}
        active={active}
        onSelect={() => setSelectedItemId(item.id)}
        aside={aside}
        actions={copyButton}
        onContextMenu={onContextMenu}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <span
            className="mono"
            style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--color-text-faint)", fontSize: 11 }}
          >
            {isPinned && <PinGlyph />}
            {item.repoFullName}
          </span>
          <span
            className="mono"
            style={{ color: "var(--color-text-faint)", fontSize: 11 }}
          >
            #{pr.number}
          </span>
          {variant === "review" ? (
            <>
              {pr.isAuthorOnMyTeam && <Pill tone="accent">team</Pill>}
              {pr.isDraft && <Pill tone="neutral">draft</Pill>}
            </>
          ) : (
            <>
              <Lifecycle
                state={pr.lifecycle}
                mqPos={pr.mergeQueue?.position ?? null}
              />
              {wasEjected && <ReasonBadge reason="ejected" />}
            </>
          )}
          {pr.approvalCount > 0 && (
            <Pill tone="success">
              <Check size={10} aria-hidden />
              {pr.approvalCount} approved
            </Pill>
          )}
          {pr.taskUrls.length > 0 && <TaskChips urls={pr.taskUrls} />}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontWeight: 600,
            color: "var(--color-text)",
            fontSize: 13,
            overflow: "hidden",
          }}
        >
          {wasEjected && (
            <AlertTriangle
              size={13}
              aria-label="Kicked from queue"
              style={{ color: "var(--color-danger)", flexShrink: 0 }}
            />
          )}
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.title}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 4,
            fontSize: 11,
            color: "var(--color-text-faint)",
          }}
        >
          <Avatar login={pr.author} size={12} />
          <span>{pr.author}</span>
          <span>·</span>
          <span className="mono">
            <span style={{ color: "var(--color-success)" }}>+{pr.additions}</span>
            <span style={{ color: "var(--color-danger)", marginLeft: 4 }}>
              −{pr.deletions}
            </span>
          </span>
        </div>
      </RowShell>
      {ctxMenu && (
        <RowContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          repoFullName={item.repoFullName}
          isPinned={isPinned}
          onClose={() => setCtxMenu(null)}
          onMuteRepo={handleMuteRepo}
          onMuteOrg={handleMuteOrg}
          onTogglePin={handleTogglePin}
        />
      )}
    </>
  );
}
