"use client";

import { BeetMark } from "@/components/BeetMark";
import { useAppVersion } from "@/hooks/useAppVersion";
import { openInBrowser } from "@/lib/openInBrowser";

export function AboutTab() {
  const version = useAppVersion();

  return (
    <div
      className="flex flex-col items-center gap-5 pt-10 pb-6 text-center"
    >
      <BeetMark size={56} />
      <div className="flex flex-col items-center gap-1">
        <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.3px" }}>
          Beet
        </span>
        {version && (
          <span style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
            Version {version}
          </span>
        )}
        <span
          style={{
            fontSize: 12.5,
            color: "var(--color-text-faint)",
            marginTop: 6,
          }}
        >
          A glanceable GitHub dashboard.
        </span>
      </div>
      <a
        href="https://beet.sh"
        style={{ fontSize: 12.5, color: "var(--color-accent)" }}
        onClick={(e) => {
          e.preventDefault();
          void openInBrowser("https://beet.sh");
        }}
      >
        beet.sh
      </a>
    </div>
  );
}
