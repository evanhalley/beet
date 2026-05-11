"use client";

import { useCallback } from "react";
import type { ActionableItem } from "@/lib/types";
import { Avatar } from "./Avatar";
import { Pill } from "./Pill";
import { ScoreBar } from "./ScoreBar";
import { TaskChips } from "./TaskChips";

export type RowVariant = "needs" | "review" | "inflight" | "run";

export interface ActionableRowProps {
  item: ActionableItem;
  variant: RowVariant;
}

async function openInBrowser(url: string): Promise<void> {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } catch {
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }
}

export function ActionableRow({ item, variant }: ActionableRowProps) {
  const onClick = useCallback(() => {
    void openInBrowser(item.url);
  }, [item.url]);

  const pr = item.pr;
  const author = pr?.author;
  const isDraft = pr?.isDraft;
  const isTeam = pr?.isAuthorOnMyTeam;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Open ${item.title} on GitHub`}
      style={{
        width: "100%",
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 10,
        alignItems: "center",
        padding: "10px 16px",
        background: "transparent",
        borderTop: "1px solid var(--color-border)",
        borderLeft: "2px solid transparent",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: 3,
          background: item.unread ? "var(--color-accent)" : "transparent",
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
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
          {variant === "review" && isTeam && <Pill tone="accent">team</Pill>}
          {variant === "review" && isDraft && <Pill tone="neutral">draft</Pill>}
          {pr && pr.taskUrls.length > 0 && <TaskChips urls={pr.taskUrls} />}
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
        {author && (
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
            <Avatar login={author} size={12} />
            <span>{author}</span>
            {pr && (
              <>
                <span>·</span>
                <span className="mono">
                  <span style={{ color: "var(--color-success)" }}>
                    +{pr.additions}
                  </span>
                  <span style={{ color: "var(--color-danger)", marginLeft: 4 }}>
                    −{pr.deletions}
                  </span>
                </span>
              </>
            )}
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 5,
        }}
      >
        {variant === "review" && pr && <ScoreBar score={pr.score} width={26} />}
      </div>
    </button>
  );
}
