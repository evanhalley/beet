"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { Check, GitBranch } from "lucide-react";
import type { BranchCopyTarget } from "@/lib/branch";
import { copyToClipboard } from "@/lib/copyToClipboard";

const COPIED_MS = 1500;

/**
 * One-click copy of a branch name, shaped like the 22×22 copy-link buttons.
 * Stops click and key propagation so it can sit inside rows whose own handler
 * selects the item or opens the browser.
 */
export function CopyBranchButton({ branch, checkoutCommand }: BranchCopyTarget) {
  const text = checkoutCommand ?? branch;
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const onClick = async (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const ok = await copyToClipboard(text);
    if (!ok) return;
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  };

  // Keep Enter/Space from reaching a parent role="button" row, which would
  // otherwise open the item. The button's own activation still fires.
  const onKeyDown = (e: KeyboardEvent) => e.stopPropagation();

  const Icon = copied ? Check : GitBranch;
  return (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={onKeyDown}
      aria-label={
        checkoutCommand
          ? `Copy checkout command ${checkoutCommand}`
          : `Copy branch name ${branch}`
      }
      title={
        copied
          ? "Copied!"
          : checkoutCommand
            ? `Copy "${checkoutCommand}" (branch is on a fork)`
            : "Copy branch name"
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        width: 22,
        height: 22,
        borderRadius: 5,
        background: copied ? "var(--color-success-soft)" : "transparent",
        color: copied ? "var(--color-success)" : "var(--color-text-faint)",
        cursor: "pointer",
      }}
    >
      <Icon size={13} aria-hidden />
    </button>
  );
}

/**
 * Branch name followed by its copy button, for 11px meta lines (tray rows,
 * detail header). The name ellipsizes so long branches don't push siblings
 * off the line; negative margins keep the 22px hit target from growing it.
 */
export function BranchWithCopy({ target }: { target: BranchCopyTarget | null }) {
  if (!target) return null;
  const { branch } = target;
  return (
    <>
      <span
        className="mono"
        title={branch}
        style={{
          minWidth: 0,
          // Absorb nearly all of the line's shrinkage so neighbouring pills
          // and task chips keep their natural width.
          flexShrink: 100,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--color-text-faint)",
          fontSize: 11,
        }}
      >
        {branch}
      </span>
      <span style={{ display: "inline-flex", flexShrink: 0, margin: "-5px -4px -5px -6px" }}>
        <CopyBranchButton {...target} />
      </span>
    </>
  );
}
