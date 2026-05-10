import type { ReactNode } from "react";

export function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-[22px] max-w-[620px]">{children}</div>;
}

export function H({ children }: { children: ReactNode }) {
  return (
    <h2
      className="m-0 -mb-2 font-semibold"
      style={{ fontSize: 16, letterSpacing: "-0.1px" }}
    >
      {children}
    </h2>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div
        className="mb-1.5 font-semibold uppercase"
        style={{
          fontSize: 11,
          color: "var(--color-text-muted)",
          letterSpacing: "0.5px",
        }}
      >
        {label}
      </div>
      {children}
      {hint && (
        <div
          className="mt-1.5 leading-[1.5]"
          style={{ fontSize: 11.5, color: "var(--color-text-faint)" }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

export const inputClass =
  "w-full rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-0";

export function inputStyle(mono = false): React.CSSProperties {
  return {
    padding: "7px 10px",
    fontSize: mono ? 11.5 : 12.5,
    background: "var(--color-panel)",
    borderColor: "var(--color-border)",
    color: "var(--color-text)",
    fontFamily: mono ? "var(--font-mono)" : "inherit",
  };
}

export function btnStyle(kind?: "primary"): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "6px 12px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: "nowrap",
  };
  if (kind === "primary") {
    return {
      ...base,
      background: "var(--color-accent)",
      color: "var(--color-accent-fg)",
    };
  }
  return {
    ...base,
    background: "var(--color-panel)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
  };
}

export type PillTone = "success" | "warn" | "danger" | "accent" | "neutral";

const PILL_COLORS: Record<PillTone, { fg: string; soft: string; border: string }> = {
  success: {
    fg: "var(--color-success)",
    soft: "var(--color-success-soft)",
    border: "var(--color-success-border)",
  },
  warn: {
    fg: "var(--color-warn)",
    soft: "var(--color-warn-soft)",
    border: "var(--color-warn-border)",
  },
  danger: {
    fg: "var(--color-danger)",
    soft: "var(--color-danger-soft)",
    border: "var(--color-danger-border)",
  },
  accent: {
    fg: "var(--color-accent)",
    soft: "var(--color-accent-soft)",
    border: "var(--color-accent)",
  },
  neutral: {
    fg: "var(--color-text-muted)",
    soft: "var(--color-panel)",
    border: "var(--color-border)",
  },
};

export function Pill({
  tone = "neutral",
  soft = false,
  children,
}: {
  tone?: PillTone;
  soft?: boolean;
  children: ReactNode;
}) {
  const c = PILL_COLORS[tone];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"
      style={{
        fontSize: 11,
        fontWeight: 500,
        color: c.fg,
        background: soft ? c.soft : "transparent",
        borderColor: c.border,
      }}
    >
      {children}
    </span>
  );
}
