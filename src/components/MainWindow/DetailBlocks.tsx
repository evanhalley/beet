// Small primitives shared by the DetailPane's stacked blocks (Body,
// Reviewers, Checks, Files, …): the uppercase block title and the italic
// empty-state line.

export function BlockHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.06,
        color: "var(--color-text-faint)",
      }}
    >
      {title}
    </div>
  );
}

export function EmptyHint({ children }: { children: string }) {
  return (
    <div
      style={{
        marginTop: 6,
        fontSize: 11.5,
        color: "var(--color-text-faint)",
        fontStyle: "italic",
      }}
    >
      {children}
    </div>
  );
}
