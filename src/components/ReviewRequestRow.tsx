"use client";

import { useAppStore } from "@/lib/store";
import type { ActionableItem } from "@/lib/types";
import { Avatar } from "./Avatar";
import { Pill } from "./Pill";
import { RowShell } from "./RowShell";
import { ScoreBar } from "./ScoreBar";
import { TaskChips } from "./TaskChips";

export interface ReviewRequestRowProps {
  item: ActionableItem;
}

export function ReviewRequestRow({ item }: ReviewRequestRowProps) {
  const pr = item.pr;
  const active = useAppStore((s) => s.selectedItemId === item.id);
  const setSelectedItemId = useAppStore((s) => s.setSelectedItemId);
  if (!pr) return null;

  return (
    <RowShell
      ariaLabel={`Select ${item.title}`}
      unread={item.unread}
      active={active}
      onSelect={() => setSelectedItemId(item.id)}
      aside={<ScoreBar score={pr.score} width={26} />}
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
        {pr.isAuthorOnMyTeam && <Pill tone="accent">team</Pill>}
        {pr.isDraft && <Pill tone="neutral">draft</Pill>}
        {pr.taskUrls.length > 0 && <TaskChips urls={pr.taskUrls} />}
      </div>
      <div
        style={{
          fontWeight: item.unread ? 600 : 500,
          color: item.unread ? "var(--color-text)" : "var(--color-text-muted)",
          fontSize: 13,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {item.title}
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
