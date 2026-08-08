"use client";

import { useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { Field, H, Stack } from "./atoms";

export function GeneralTab() {
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
      <Field
        label="Launch at login"
        hint="Start Beet automatically when you log in. It opens in the menu bar."
      >
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
            aria-label="Launch at login"
            checked={autostart}
            onChange={(e) => void toggleAutostart(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: "var(--color-accent)" }}
          />
          <span style={{ fontSize: 12.5, color: "var(--color-text)" }}>
            {autostart ? "On" : "Off"}
          </span>
        </label>
      </Field>
    </Stack>
  );
}
