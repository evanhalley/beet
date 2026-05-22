import { Pin } from "lucide-react";

// Small pin indicator rendered next to the repo label on pinned-repo rows (§8).
export function PinGlyph() {
  return (
    <Pin
      size={10}
      style={{ color: "var(--color-accent)", flexShrink: 0 }}
      aria-label="pinned"
    />
  );
}
