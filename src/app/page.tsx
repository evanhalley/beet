"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useMyOpenPrs } from "@/hooks/useMyOpenPrs";
import { useReviewRequests } from "@/hooks/useReviewRequests";
import { MissingTokenBanner, type MissingTokenReason } from "@/components/MissingTokenBanner";
import { SettingsPanel } from "@/components/Settings/SettingsPanel";
import { MainWindowShell } from "@/components/MainWindow/MainWindowShell";
import { useAppStore } from "@/lib/store";

const ERROR_BANNER_TIMEOUT_MS = 4000;

export default function Page() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { token, auth, isLoading } = useAuth();
  useReviewRequests();
  useMyOpenPrs();
  const uiError = useAppStore((s) => s.uiError);
  const setUiError = useAppStore((s) => s.setUiError);

  useEffect(() => {
    if (!uiError) return;
    const id = window.setTimeout(
      () => setUiError(null),
      ERROR_BANNER_TIMEOUT_MS,
    );
    return () => window.clearTimeout(id);
  }, [uiError, setUiError]);

  if (settingsOpen) {
    return <SettingsPanel onClose={() => setSettingsOpen(false)} />;
  }

  const bannerReason: MissingTokenReason | null = (() => {
    if (isLoading) return null;
    if (!token) return "no_token";
    if (auth?.error === "invalid") return "invalid";
    return null;
  })();

  return (
    <div className="flex min-h-screen flex-col">
      {bannerReason && (
        <MissingTokenBanner
          reason={bannerReason}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      {uiError && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px",
            background: "var(--color-danger-soft, rgba(220, 60, 60, 0.12))",
            borderBottom: "1px solid var(--color-border)",
            fontSize: 12,
            color: "var(--color-text)",
          }}
        >
          <span style={{ flex: 1 }}>{uiError}</span>
          <button
            type="button"
            onClick={() => setUiError(null)}
            aria-label="Dismiss error"
            style={{
              display: "inline-flex",
              alignItems: "center",
              background: "transparent",
              cursor: "pointer",
              padding: 2,
              color: "var(--color-text-muted)",
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <MainWindowShell
        onOpenSettings={() => setSettingsOpen(true)}
        settingsOpen={settingsOpen}
      />
    </div>
  );
}
