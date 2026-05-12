"use client";

import { useCallback, type ReactNode } from "react";
import { useAppStore } from "@/lib/store";

async function openInBrowser(url: string): Promise<void> {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
    return;
  } catch (tauriErr) {
    if (typeof window !== "undefined") {
      try {
        const w = window.open(url, "_blank", "noopener,noreferrer");
        if (w) return;
      } catch {
        // fall through
      }
    }
    console.error("openInBrowser failed", tauriErr);
    useAppStore.getState().setUiError(`Couldn't open ${url}`);
  }
}

export interface RowShellProps {
  url: string;
  ariaLabel: string;
  unread: boolean;
  children: ReactNode;
  aside?: ReactNode;
}

export function RowShell({ url, ariaLabel, unread, children, aside }: RowShellProps) {
  const onClick = useCallback(() => {
    void openInBrowser(url);
  }, [url]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        width: "100%",
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 10,
        alignItems: "center",
        padding: "10px 16px",
        background: "transparent",
        borderTop: "1px solid var(--color-border)",
        borderLeft: "2px solid transparent",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: 3,
          background: unread ? "var(--color-accent)" : "transparent",
        }}
      />
      <div style={{ minWidth: 0 }}>{children}</div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 5,
        }}
      >
        {aside}
      </div>
    </button>
  );
}
