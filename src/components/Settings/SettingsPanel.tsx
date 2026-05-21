"use client";

import { useState } from "react";
import { BeetMark } from "@/components/BeetMark";
import { useAppVersion } from "@/hooks/useAppVersion";
import { AboutTab } from "./AboutTab";
import { AccountTab } from "./AccountTab";
import { AppearanceTab } from "./AppearanceTab";
import { MergeQueueTab } from "./MergeQueueTab";
import { MutePinTab } from "./MutePinTab";
import { NotificationsTab } from "./NotificationsTab";
import { RunsTab } from "./RunsTab";
import { ScoringTab } from "./ScoringTab";
import { PollingTab } from "./PollingTab";
import { NavIcon, type NavIconName } from "./NavIcon";

interface NavItem {
  id:
    | "account"
    | "notifications"
    | "scoring"
    | "polling"
    | "appearance"
    | "merge-queue"
    | "mute-pin"
    | "runs"
    | "about";
  label: string;
  icon: NavIconName;
}

const ITEMS: readonly NavItem[] = [
  { id: "account", label: "Account", icon: "user" },
  { id: "notifications", label: "Notifications", icon: "bell" },
  { id: "appearance", label: "Appearance", icon: "theme" },
  { id: "scoring", label: "Scoring", icon: "score" },
  { id: "polling", label: "Polling", icon: "refresh" },
  { id: "runs", label: "Runs", icon: "runs" },
  { id: "mute-pin", label: "Mute & Pin", icon: "mute" },
  { id: "merge-queue", label: "Merge Queue", icon: "merge" },
  { id: "about", label: "About", icon: "info" },
] as const;

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<NavItem["id"]>("account");
  const appVersion = useAppVersion();

  return (
    <div
      role="dialog"
      aria-label="Settings"
      className="flex min-h-screen w-full flex-col overflow-hidden"
      style={{ background: "var(--color-bg)", color: "var(--color-text)" }}
    >
      <header
        data-tauri-drag-region
        className="flex items-center gap-2.5 border-b"
        style={{
          // Fixed height + left padding aligns header content with the
          // macOS traffic-light buttons (since the native bar is hidden).
          height: 38,
          padding: "0 14px 0 84px",
          borderColor: "var(--color-border)",
          background:
            "linear-gradient(180deg, var(--color-panel), var(--color-bg))",
        }}
      >
        <BeetMark size={18} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Settings</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="inline-flex items-center justify-center rounded-full"
          style={{
            width: 22,
            height: 22,
            color: "var(--color-text-faint)",
          }}
        >
          ×
        </button>
      </header>

      <div
        className="grid flex-1 min-h-0"
        style={{ gridTemplateColumns: "180px 1fr" }}
      >
        <nav
          className="flex flex-col gap-px border-r"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-panel)",
            padding: "16px 10px",
          }}
          aria-label="Settings sections"
        >
          {ITEMS.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-current={active ? "page" : undefined}
                className="flex items-center gap-2.5 rounded-md text-left"
                style={{
                  padding: "7px 10px",
                  fontSize: 12.5,
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--color-accent)" : "var(--color-text-muted)",
                  background: active ? "var(--color-accent-soft)" : "transparent",
                }}
              >
                <NavIcon name={item.icon} />
                {item.label}
              </button>
            );
          })}
          <span className="flex-1" />
          <div
            style={{
              padding: "6px 10px",
              fontSize: 10.5,
              color: "var(--color-text-faint)",
              lineHeight: 1.5,
            }}
          >
            Beet {appVersion ?? ""}
          </div>
        </nav>

        <div className="overflow-y-auto" style={{ padding: "20px 28px" }}>
          {tab === "account" && <AccountTab />}
          {tab === "notifications" && <NotificationsTab />}
          {tab === "scoring" && <ScoringTab />}
          {tab === "polling" && <PollingTab />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "runs" && <RunsTab />}
          {tab === "mute-pin" && <MutePinTab />}
          {tab === "merge-queue" && <MergeQueueTab />}
          {tab === "about" && <AboutTab />}
        </div>
      </div>
    </div>
  );
}
