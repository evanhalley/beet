"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Settings as SettingsIcon, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useReviewRequests } from "@/hooks/useReviewRequests";
import { MissingTokenBanner, type MissingTokenReason } from "@/components/MissingTokenBanner";
import { SettingsPanel } from "@/components/Settings/SettingsPanel";
import { ReviewRequestsSection } from "@/components/ReviewRequestsSection";
import { useAppStore } from "@/lib/store";

const ERROR_BANNER_TIMEOUT_MS = 4000;

export default function Page() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { token, auth, isLoading } = useAuth();
  useReviewRequests();
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

  const hasToken = !!token && auth?.ok;

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
      <header
        className="flex items-center gap-2.5 px-4 py-2.5 border-b"
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-panel)",
        }}
      >
        <Image src="/beet-mark.svg" alt="" width={18} height={18} priority />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Beet</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Open Settings"
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium"
          style={{
            background: "var(--color-panel)",
            borderColor: "var(--color-border)",
            color: "var(--color-text)",
          }}
        >
          <SettingsIcon size={14} /> Settings
        </button>
      </header>

      <main className="flex flex-1 flex-col">
        {hasToken ? (
          <>
            <ReviewRequestsSection />
            <p
              style={{
                padding: "14px 16px",
                fontSize: 11.5,
                color: "var(--color-text-faint)",
                borderTop: "1px solid var(--color-border)",
              }}
            >
              In Flight, Standalone Runs, Recently Resolved land in later iterations.
            </p>
          </>
        ) : (
          <section
            className="m-8 flex flex-col items-center gap-5 rounded-xl border px-12 py-10 shadow-sm self-center"
            style={{
              background: "var(--color-bg-elev)",
              borderColor: "var(--color-border)",
            }}
          >
            <Image src="/beet-mark.svg" alt="" width={64} height={64} priority />
            <h1 className="text-3xl font-semibold tracking-tight">Beet 🫜</h1>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              A glanceable GitHub dashboard.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
