"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties, MouseEvent } from "react";
import { Clock, Eye, EyeOff, Pin, PinOff, VolumeX } from "lucide-react";

export interface RowContextMenuProps {
  x: number;
  y: number;
  repoFullName: string;
  isPinned: boolean;
  // When true the row is currently suppressed (visible only because Show-All is
  // on); the action becomes "Unsuppress". Omitted for rows that can't be
  // suppressed (e.g. standalone runs).
  isSuppressed?: boolean;
  // When true the row is actively snoozed; the three durations collapse into a
  // single "Unsnooze" item. Omit onSnooze for rows that can't be snoozed.
  isSnoozed?: boolean;
  onClose: () => void;
  onMuteRepo: () => void;
  onMuteOrg: () => void;
  onTogglePin: () => void;
  onToggleSuppress?: () => void;
  onSnooze?: (hours: number) => void;
  onUnsnooze?: () => void;
}

const SNOOZE_OPTIONS: readonly { label: string; hours: number }[] = [
  { label: "Snooze 1 hour", hours: 1 },
  { label: "Snooze 4 hours", hours: 4 },
  { label: "Snooze 1 day", hours: 24 },
];

const menuItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 12px",
  fontSize: 12.5,
  cursor: "pointer",
  color: "var(--color-text)",
  background: "transparent",
  border: "none",
  width: "100%",
  textAlign: "left",
  borderRadius: 4,
  whiteSpace: "nowrap",
};

export function RowContextMenu({
  x,
  y,
  repoFullName,
  isPinned,
  isSuppressed = false,
  isSnoozed = false,
  onClose,
  onMuteRepo,
  onMuteOrg,
  onTogglePin,
  onToggleSuppress,
  onSnooze,
  onUnsnooze,
}: RowContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const owner = repoFullName.split("/")[0] ?? repoFullName;

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  // Hover highlight for menu items. Applied imperatively because every item
  // shares the `menuItemStyle` object — there's no per-item :hover rule.
  const onItemEnter = (e: MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = "var(--color-hover)";
  };
  const onItemLeave = (e: MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = "transparent";
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Row actions"
      style={{
        position: "fixed",
        left: x,
        top: y,
        zIndex: 9999,
        background: "var(--color-panel)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
        padding: 4,
        minWidth: 180,
      }}
    >
      <button
        type="button"
        role="menuitem"
        style={menuItemStyle}
        onClick={() => {
          onMuteRepo();
          onClose();
        }}
        onMouseEnter={onItemEnter}
        onMouseLeave={onItemLeave}
      >
        <VolumeX size={13} style={{ color: "var(--color-text-faint)" }} />
        Mute repo {repoFullName}
      </button>

      <button
        type="button"
        role="menuitem"
        style={menuItemStyle}
        onClick={() => {
          onMuteOrg();
          onClose();
        }}
        onMouseEnter={onItemEnter}
        onMouseLeave={onItemLeave}
      >
        <VolumeX size={13} style={{ color: "var(--color-text-faint)" }} />
        Mute org {owner}
      </button>

      <div
        style={{
          height: 1,
          background: "var(--color-border)",
          margin: "4px 8px",
        }}
      />

      <button
        type="button"
        role="menuitem"
        style={menuItemStyle}
        onClick={() => {
          onTogglePin();
          onClose();
        }}
        onMouseEnter={onItemEnter}
        onMouseLeave={onItemLeave}
      >
        {isPinned ? (
          <PinOff size={13} style={{ color: "var(--color-accent)" }} />
        ) : (
          <Pin size={13} style={{ color: "var(--color-text-faint)" }} />
        )}
        {isPinned ? `Unpin ${repoFullName}` : `Pin ${repoFullName}`}
      </button>

      {onToggleSuppress && (
        <button
          type="button"
          role="menuitem"
          style={menuItemStyle}
          onClick={() => {
            onToggleSuppress();
            onClose();
          }}
          onMouseEnter={onItemEnter}
          onMouseLeave={onItemLeave}
        >
          {isSuppressed ? (
            <Eye size={13} style={{ color: "var(--color-accent)" }} />
          ) : (
            <EyeOff size={13} style={{ color: "var(--color-text-faint)" }} />
          )}
          {isSuppressed ? "Unsuppress this PR" : "Suppress this PR"}
        </button>
      )}

      {onSnooze && (
        <>
          <div
            style={{
              height: 1,
              background: "var(--color-border)",
              margin: "4px 8px",
            }}
          />
          {isSnoozed ? (
            <button
              type="button"
              role="menuitem"
              style={menuItemStyle}
              onClick={() => {
                onUnsnooze?.();
                onClose();
              }}
              onMouseEnter={onItemEnter}
              onMouseLeave={onItemLeave}
            >
              <Clock size={13} style={{ color: "var(--color-accent)" }} />
              Unsnooze
            </button>
          ) : (
            SNOOZE_OPTIONS.map(({ label, hours }) => (
              <button
                key={hours}
                type="button"
                role="menuitem"
                style={menuItemStyle}
                onClick={() => {
                  onSnooze(hours);
                  onClose();
                }}
                onMouseEnter={onItemEnter}
                onMouseLeave={onItemLeave}
              >
                <Clock size={13} style={{ color: "var(--color-text-faint)" }} />
                {label}
              </button>
            ))
          )}
        </>
      )}
    </div>
  );
}
