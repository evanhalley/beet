"use client";

import { useState, type MouseEvent } from "react";
import { Check, Cog, Link2 } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { copyToClipboard } from "@/lib/copyToClipboard";
import dayjs from "@/lib/dayjs";
import type { ActionableItem } from "@/lib/types";
import { CheckDot, deriveCheckDotState } from "./CheckDot";
import { RowShell } from "./RowShell";

export interface RunRowProps {
  item: ActionableItem;
}

export function RunRow({ item }: RunRowProps) {
  const run = item.run;
  const active = useAppStore((s) => s.selectedItemId === item.id);
  const setSelectedItemId = useAppStore((s) => s.setSelectedItemId);
  const [copied, setCopied] = useState(false);
  if (!run) return null;

  const dot = deriveCheckDotState(run.status, run.conclusion);

  const onCopy = async (e: MouseEvent) => {
    e.stopPropagation();
    const ok = await copyToClipboard(run.runUrl);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  const copyButton = (
    <button
      type="button"
      onClick={onCopy}
      aria-label={`Copy link to ${run.workflowName}`}
      title={copied ? "Copied!" : "Copy run URL"}
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

  // Branch label: prefer the actual branch, fall back to a short SHA so the
  // user can still tell two runs of the same workflow apart.
  const branchLabel = run.branch ?? (run.sha ? run.sha.slice(0, 7) : "");

  return (
    <RowShell
      ariaLabel={`Select ${run.workflowName}`}
      unread={item.unread}
      active={active}
      onSelect={() => setSelectedItemId(item.id)}
      aside={<CheckDot state={dot} />}
      actions={copyButton}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 3,
        }}
      >
        <Cog
          size={12}
          aria-hidden
          style={{ color: "var(--color-text-faint)", flexShrink: 0 }}
        />
        <span
          className="mono"
          style={{ color: "var(--color-text-faint)", fontSize: 11 }}
        >
          {item.repoFullName}
        </span>
        {branchLabel && (
          <span
            className="mono"
            style={{ color: "var(--color-text-faint)", fontSize: 11 }}
          >
            {branchLabel}
          </span>
        )}
        <span
          style={{
            fontSize: 10.5,
            padding: "0 6px",
            borderRadius: 999,
            background: "var(--color-panel-2)",
            color: "var(--color-text-faint)",
            textTransform: "lowercase",
          }}
        >
          {run.event}
        </span>
      </div>
      <div
        style={{
          fontWeight: 600,
          color: "var(--color-text)",
          fontSize: 13,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {run.workflowName}
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
        <span>@{run.actorLogin}</span>
        {run.status === "in_progress" ? (
          <>
            <span>·</span>
            <span>running…</span>
          </>
        ) : run.conclusion ? (
          <>
            <span>·</span>
            <span
              style={{
                color:
                  run.conclusion === "success"
                    ? "var(--color-success)"
                    : run.conclusion === "failure"
                      ? "var(--color-danger)"
                      : "inherit",
              }}
            >
              {run.conclusion}
            </span>
          </>
        ) : null}
        <span>·</span>
        <span className="mono">#{run.runNumber}</span>
        <span>·</span>
        <span
          className="mono"
          title={item.updatedAt}
          aria-label={`Updated ${item.updatedAt}`}
        >
          {dayjs(item.updatedAt).fromNow()}
        </span>
      </div>
    </RowShell>
  );
}
