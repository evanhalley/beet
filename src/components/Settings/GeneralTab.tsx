"use client";

import { useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useAppStore } from "@/lib/store";
import { setGlobalShortcutEnabled } from "@/lib/storage/settings";
import { Field, H, Stack } from "./atoms";

interface ToggleRowProps {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ label, hint, value, onChange }: ToggleRowProps) {
  return (
    <Field label={label} hint={hint}>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <input
          type="checkbox"
          aria-label={label}
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          style={{ width: 16, height: 16, accentColor: "var(--color-accent)" }}
        />
        <span style={{ fontSize: 12.5, color: "var(--color-text)" }}>
          {value ? "On" : "Off"}
        </span>
      </label>
    </Field>
  );
}

export function GeneralTab() {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  // The LaunchAgent itself is the source of truth — no settings key to drift.
  const [autostart, setAutostart] = useState(false);

  useEffect(() => {
    let cancelled = false;
    isEnabled()
      .then((v) => {
        if (!cancelled) setAutostart(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleAutostart = async (v: boolean) => {
    setAutostart(v);
    try {
      if (v) {
        await enable();
      } else {
        await disable();
      }
    } catch {
      setAutostart(!v);
    }
  };

  return (
    <Stack>
      <H>General</H>
      <ToggleRow
        label="Launch at login"
        hint="Start Beet automatically when you log in. It opens in the menu bar."
        value={autostart}
        onChange={(v) => void toggleAutostart(v)}
      />
      <ToggleRow
        label="Toggle Beet from anywhere (⌥⇧B)"
        hint="Global shortcut that opens or hides the menu-bar popover from any app."
        value={settings.globalShortcutEnabled}
        onChange={async (v) => {
          setSettings({ globalShortcutEnabled: v });
          await setGlobalShortcutEnabled(v);
        }}
      />
    </Stack>
  );
}
