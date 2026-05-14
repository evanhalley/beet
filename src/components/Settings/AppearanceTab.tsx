"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useAppStore } from "@/lib/store";
import { setTheme, type ThemeMode } from "@/lib/storage/settings";
import { applyTheme } from "@/lib/theme";
import { Field, H, Stack } from "./atoms";

interface Option {
  value: ThemeMode;
  label: string;
  icon: ReactNode;
  hint: string;
}

const OPTIONS: readonly Option[] = [
  {
    value: "light",
    label: "Light",
    icon: <Sun size={14} aria-hidden />,
    hint: "Bright background; ignores OS preference.",
  },
  {
    value: "dark",
    label: "Dark",
    icon: <Moon size={14} aria-hidden />,
    hint: "Dark background; ignores OS preference.",
  },
  {
    value: "system",
    label: "System",
    icon: <Monitor size={14} aria-hidden />,
    hint: "Match the operating system.",
  },
] as const;

export function AppearanceTab() {
  const value = useAppStore((s) => s.settings.theme);
  const setSettings = useAppStore((s) => s.setSettings);

  const onChange = async (next: ThemeMode) => {
    setSettings({ theme: next });
    applyTheme(next);
    try {
      await setTheme(next);
    } catch {
      // Tauri-less / test environments — applyTheme already wrote the
      // localStorage hint and the in-memory store update so the UI stays
      // consistent without persistence.
    }
  };

  return (
    <Stack>
      <H>Appearance</H>
      <Field
        label="Theme"
        hint="Changes apply immediately and persist across launches."
      >
        <div
          role="radiogroup"
          aria-label="Theme"
          className="flex flex-col gap-1.5"
        >
          {OPTIONS.map((opt) => {
            const checked = value === opt.value;
            return (
              <label
                key={opt.value}
                className="flex items-center gap-2.5 rounded-md cursor-pointer"
                style={{
                  padding: "8px 10px",
                  border: "1px solid var(--color-border)",
                  background: checked
                    ? "var(--color-accent-soft)"
                    : "var(--color-panel)",
                }}
              >
                <input
                  type="radio"
                  name="theme"
                  value={opt.value}
                  checked={checked}
                  onChange={() => void onChange(opt.value)}
                  aria-label={opt.label}
                  style={{ accentColor: "var(--color-accent)" }}
                />
                <span
                  style={{
                    display: "inline-flex",
                    color: checked
                      ? "var(--color-accent)"
                      : "var(--color-text-muted)",
                  }}
                >
                  {opt.icon}
                </span>
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: checked ? 600 : 500,
                    color: checked
                      ? "var(--color-accent)"
                      : "var(--color-text)",
                  }}
                >
                  {opt.label}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontSize: 11.5,
                    color: "var(--color-text-faint)",
                    textAlign: "right",
                  }}
                >
                  {opt.hint}
                </span>
              </label>
            );
          })}
        </div>
      </Field>
    </Stack>
  );
}
