"use client";

import { useEffect, useState, useCallback } from "react";
import { X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useAuth } from "@/hooks/useAuth";
import { usePollEvents } from "@/hooks/usePollEvents";
import { useTrayBadge } from "@/hooks/useTrayBadge";
import { useTrayCommands } from "@/hooks/useTrayCommands";
import { useThemeSync } from "@/hooks/useThemeSync";
import { MissingTokenBanner, type MissingTokenReason } from "@/components/MissingTokenBanner";
import { SettingsPanel } from "@/components/Settings/SettingsPanel";
import { MainWindowShell } from "@/components/MainWindow/MainWindowShell";
import { useAppStore } from "@/lib/store";

const ERROR_BANNER_TIMEOUT_MS = 4000;

export default function Page() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { token, auth, isLoading } = useAuth();
  usePollEvents();
  useTrayBadge();
  useTrayCommands();
  useThemeSync();
  const uiError = useAppStore((s) => s.uiError);
  const setUiError = useAppStore((s) => s.setUiError);
  const pollError = useAppStore((s) => s.pollError);

  // Open settings when the tray menu "Settings" item is clicked.
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  useEffect(() => {
    const unlisten = listen("tray:open-settings", openSettings);
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [openSettings]);

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

  // Banners render below the TitleBar (inside MainWindowShell) so they clear
  // the macOS traffic-light buttons, which overlay the top-left of the window.
  const banner = (
    <>
      {bannerReason && (
        <MissingTokenBanner
          reason={bannerReason}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      {/* Poll-cycle error from the Rust loop. Not dismissable — a successful
          cycle clears it. Suppressed while the missing-token banner shows, to
          avoid restating the same problem. */}
      {!bannerReason && pollError && (
        <div
          role="alert"
          style={{
            padding: "8px 14px",
            background: "var(--color-danger-soft, rgba(220, 60, 60, 0.12))",
            borderBottom: "1px solid var(--color-border)",
            fontSize: 12,
            color: "var(--color-text)",
          }}
        >
          {pollError}
        </div>
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
    </>
  );

  return (
    <div className="flex h-screen flex-col">
      <MainWindowShell
        banner={banner}
        onOpenSettings={() => setSettingsOpen(true)}
        settingsOpen={settingsOpen}
      />
    </div>
  );
}
