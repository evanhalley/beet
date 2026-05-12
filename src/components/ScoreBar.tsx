export interface ScoreBarProps {
  score: number;
  width?: number;
}

export function ScoreBar({ score, width = 28 }: ScoreBarProps) {
  const pct = Math.max(0, Math.min(1, score / 15));
  const color =
    score >= 10
      ? "var(--color-accent)"
      : score >= 5
        ? "var(--color-text-muted)"
        : "var(--color-text-faint)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width,
          height: 4,
          borderRadius: 2,
          background: "var(--color-panel-2)",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${pct * 100}%`,
            background: color,
            transition: "width .2s",
          }}
        />
      </span>
      <span
        className="mono"
        style={{
          fontSize: 10,
          color: "var(--color-text-faint)",
          minWidth: 12,
          textAlign: "right",
        }}
      >
        {score}
      </span>
    </span>
  );
}
