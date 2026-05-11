"use client";

import { AlertTriangle } from "lucide-react";

export type MissingTokenReason = "no_token" | "invalid";

const COPY: Record<MissingTokenReason, string> = {
  no_token: "Add a GitHub token to start tracking PRs.",
  invalid: "Token rejected by GitHub. Check Settings.",
};

export function MissingTokenBanner({
  reason,
  onOpenSettings,
}: {
  reason: MissingTokenReason;
  onOpenSettings: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b px-4 py-3 text-sm"
      style={{
        background: "var(--color-warn-soft)",
        borderColor: "var(--color-warn-border)",
        color: "var(--color-text)",
      }}
    >
      <AlertTriangle size={16} style={{ color: "var(--color-warn)" }} />
      <span className="flex-1">{COPY[reason]}</span>
      <button
        type="button"
        onClick={onOpenSettings}
        className="rounded-md px-3 py-1 text-xs font-medium border"
        style={{
          background: "var(--color-panel)",
          borderColor: "var(--color-border)",
          color: "var(--color-text)",
        }}
      >
        Open Settings
      </button>
    </div>
  );
}
