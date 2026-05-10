"use client";

import { useState } from "react";
import Image from "next/image";
import { Settings as SettingsIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { MissingTokenBanner, type MissingTokenReason } from "@/components/MissingTokenBanner";
import { SettingsPanel } from "@/components/Settings/SettingsPanel";

export default function Page() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { auth, isLoading } = useAuth();

  if (settingsOpen) {
    return <SettingsPanel onClose={() => setSettingsOpen(false)} />;
  }

  const bannerReason: MissingTokenReason | null = (() => {
    if (isLoading) return null;
    if (!auth) return null;
    if (auth.error === "no_token") return "no_token";
    if (auth.error === "invalid") return "invalid";
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
      <main className="relative flex flex-1 items-center justify-center p-8">
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Open Settings"
          className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium"
          style={{
            background: "var(--color-panel)",
            borderColor: "var(--color-border)",
            color: "var(--color-text)",
          }}
        >
          <SettingsIcon size={14} /> Settings
        </button>
        <section
          className="flex flex-col items-center gap-5 rounded-xl border px-12 py-10 shadow-sm"
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
      </main>
    </div>
  );
}
