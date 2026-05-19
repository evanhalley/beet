"use client";

/**
 * Loading placeholder that mimics the shape of an `ActionableRow` while the
 * Rust poll loop hasn't produced its first result yet. We render a small
 * stack of these inside each list section during cold start so the panes
 * read as "loading" instead of "empty".
 */
export function SkeletonRow() {
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
        animation: "beet-pulse 1.4s ease-in-out infinite",
      }}
    >
      <Bar w={6} h={6} radius={3} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Bar w={120} h={9} />
          <Bar w={36} h={9} />
        </div>
        <Bar w="70%" h={11} />
        <Bar w={140} h={9} />
      </div>
      <Bar w={32} h={9} />
    </div>
  );
}

function Bar({
  w,
  h,
  radius = 3,
}: {
  w: number | string;
  h: number;
  radius?: number;
}) {
  return (
    <span
      style={{
        display: "block",
        width: typeof w === "number" ? `${w}px` : w,
        height: h,
        borderRadius: radius,
        background: "var(--color-panel-2)",
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
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
