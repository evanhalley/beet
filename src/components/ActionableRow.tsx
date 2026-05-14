"use client";

import { AlertTriangle, Check } from "lucide-react";
import { useAppStore } from "@/lib/store";
import type { ActionableItem } from "@/lib/types";
import { Avatar } from "./Avatar";
import { Lifecycle } from "./Lifecycle";
import { Pill } from "./Pill";
import { ReasonBadge } from "./ReasonBadge";
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
  if (!pr) return null;

  const wasEjected = (pr.mergeQueue?.ejectedChecks?.length ?? 0) > 0;

  const aside =
    variant === "review" ? <ScoreBar score={pr.score} width={26} /> : null;

  return (
    <RowShell
      ariaLabel={`Select ${item.title}`}
      unread={item.unread}
      active={active}
      onSelect={() => setSelectedItemId(item.id)}
      aside={aside}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
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
  );
}
