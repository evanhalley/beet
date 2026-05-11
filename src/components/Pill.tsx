import type { CSSProperties, ReactNode } from "react";

export type PillTone = "neutral" | "success" | "danger" | "warn" | "info" | "accent";

const MAP: Record<PillTone, { fg: string; bg: string; border: string }> = {
  neutral: {
    fg: "var(--color-text-muted)",
    bg: "var(--color-panel-2)",
    border: "var(--color-border)",
  },
  success: {
    fg: "var(--color-success)",
    bg: "var(--color-success-soft)",
    border: "transparent",
  },
  danger: {
    fg: "var(--color-danger)",
    bg: "var(--color-danger-soft)",
    border: "transparent",
  },
  warn: {
    fg: "var(--color-warn)",
    bg: "var(--color-warn-soft)",
    border: "transparent",
  },
  info: {
    fg: "var(--color-info)",
    bg: "var(--color-info-soft)",
    border: "transparent",
  },
  accent: {
    fg: "var(--color-accent)",
    bg: "var(--color-accent-soft)",
    border: "transparent",
  },
};

export interface PillProps {
  children: ReactNode;
  tone?: PillTone;
  soft?: boolean;
  mono?: boolean;
  style?: CSSProperties;
}

export function Pill({
  children,
  tone = "neutral",
  soft = true,
  mono = false,
  style,
}: PillProps) {
  const { fg, bg, border } = MAP[tone];
  return (
    <span
      className={mono ? "mono" : ""}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 6px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1.5,
        color: fg,
        background: soft ? bg : "transparent",
        border: soft ? "0" : `1px solid ${border}`,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
