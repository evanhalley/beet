"use client";

/**
 * Loading placeholder that mimics the shape of an `ActionableRow` while the
 * Rust poll loop hasn't produced its first result yet. We render a small
 * stack of these inside each list section during cold start so the panes
 * read as "loading" instead of "empty".
 */
export function SkeletonRow({ delayMs = 0 }: { delayMs?: number }) {
  return (
    <div
      aria-hidden
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 10,
        alignItems: "center",
        padding: "var(--row-pad-y, 10px) 16px",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <Bar w={6} h={6} radius={3} delayMs={delayMs} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Bar w={120} h={9} delayMs={delayMs} />
          <Bar w={36} h={9} delayMs={delayMs + 40} />
        </div>
        <Bar w="70%" h={11} delayMs={delayMs + 80} />
        <Bar w={140} h={9} delayMs={delayMs + 120} />
      </div>
      <Bar w={32} h={9} delayMs={delayMs + 160} />
    </div>
  );
}

function Bar({
  w,
  h,
  radius = 3,
  delayMs = 0,
}: {
  w: number | string;
  h: number;
  radius?: number;
  delayMs?: number;
}) {
  // Two-stop gradient: a lighter highlight band sweeps over the muted base.
  // The base + highlight tokens are themed by globals.css so the shimmer
  // works in both light and dark modes.
  return (
    <span
      style={{
        display: "block",
        width: typeof w === "number" ? `${w}px` : w,
        height: h,
        borderRadius: radius,
        background:
          "linear-gradient(90deg, var(--color-panel-2) 0%, var(--color-panel-2) 40%, var(--color-border) 50%, var(--color-panel-2) 60%, var(--color-panel-2) 100%)",
        backgroundSize: "200% 100%",
        animation: "beet-shimmer 1.6s linear infinite",
        animationDelay: `${delayMs}ms`,
      }}
    />
  );
}

export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      style={{ listStyle: "none", margin: 0, padding: 0 }}
    >
      {Array.from({ length: count }, (_, i) => (
        // Stagger row delays so adjacent rows don't shimmer in lockstep.
        <SkeletonRow key={i} delayMs={i * 180} />
      ))}
    </div>
  );
}
