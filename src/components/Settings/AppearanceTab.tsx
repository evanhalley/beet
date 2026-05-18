"use client";

import {
  ALargeSmall,
  Monitor,
  Moon,
  Rows2,
  Rows3,
  Rows4,
  Sun,
} from "lucide-react";
import type { ReactNode } from "react";
import { useAppStore } from "@/lib/store";
import {
  setAccent,
  setDensity,
  setFontScale,
  setTheme,
  type AccentColor,
  type Density,
  type FontScale,
  type ThemeMode,
} from "@/lib/storage/settings";
import {
  applyAccent,
  applyDensity,
  applyFontScale,
  applyTheme,
} from "@/lib/theme";
import { Field, H, Stack } from "./atoms";

interface RadioOption<T extends string | number> {
  value: T;
  label: string;
  icon: ReactNode;
  hint: string;
}

const THEME_OPTIONS: readonly RadioOption<ThemeMode>[] = [
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

// Colored chip swatches matching the TweakColor control in
// design/src/tweaks-panel.jsx. Each option is a flex-1 button with the accent
// as its background and a checkmark overlaid on the selected one.
interface AccentChipOption {
  value: AccentColor;
  label: string;
  color: string;
}

const ACCENT_OPTIONS: readonly AccentChipOption[] = [
  { value: "beet", label: "Beet", color: "oklch(0.52 0.16 355)" },
  { value: "ocean", label: "Ocean", color: "oklch(0.55 0.14 240)" },
  { value: "forest", label: "Forest", color: "oklch(0.5 0.13 145)" },
  { value: "ink", label: "Ink", color: "oklch(0.32 0.025 270)" },
] as const;

interface AccentChipsProps {
  value: AccentColor;
  onChange: (next: AccentColor) => void;
}

// White checkmark stroke works for all four accents — they're all dark enough
// (L ≤ 0.55) that white contrasts on them. If a future accent lifts L past
// ~0.7, swap to the design's __twkIsLight() rule and pick per-option here.
function AccentChips({ value, onChange }: AccentChipsProps) {
  return (
    <div role="radiogroup" aria-label="Accent" style={{ display: "flex", gap: 6 }}>
      {ACCENT_OPTIONS.map((opt) => {
        const checked = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => onChange(opt.value)}
            style={{
              position: "relative",
              flex: 1,
              minWidth: 0,
              height: 48,
              padding: 0,
              border: 0,
              borderRadius: 8,
              background: opt.color,
              cursor: "pointer",
              boxShadow: checked
                ? "0 0 0 2px var(--color-text), 0 2px 6px rgba(0,0,0,0.15)"
                : "0 0 0 0.5px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.08)",
              transition: "box-shadow 120ms ease, transform 120ms ease",
            }}
          >
            {checked && (
              <svg
                aria-hidden
                viewBox="0 0 14 14"
                style={{
                  position: "absolute",
                  top: 8,
                  left: 8,
                  width: 14,
                  height: 14,
                  filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.35))",
                }}
              >
                <path
                  d="M3 7.2 5.8 10 11 4.2"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}

const DENSITY_OPTIONS: readonly RadioOption<Density>[] = [
  {
    value: "compact",
    label: "Compact",
    icon: <Rows4 size={14} aria-hidden />,
    hint: "Tighter rows — fit more on screen.",
  },
  {
    value: "regular",
    label: "Regular",
    icon: <Rows3 size={14} aria-hidden />,
    hint: "The default spacing.",
  },
  {
    value: "comfy",
    label: "Comfy",
    icon: <Rows2 size={14} aria-hidden />,
    hint: "Roomier rows — easier to scan.",
  },
] as const;

const FONT_SCALE_OPTIONS: readonly RadioOption<FontScale>[] = [
  {
    value: 0.9,
    label: "Small",
    icon: <ALargeSmall size={14} aria-hidden />,
    hint: "90% — fit more on screen.",
  },
  {
    value: 1,
    label: "Default",
    icon: <ALargeSmall size={14} aria-hidden />,
    hint: "100% — the standard size.",
  },
  {
    value: 1.15,
    label: "Large",
    icon: <ALargeSmall size={14} aria-hidden />,
    hint: "115% — easier to read.",
  },
  {
    value: 1.3,
    label: "Extra Large",
    icon: <ALargeSmall size={14} aria-hidden />,
    hint: "130% — largest size.",
  },
] as const;

interface RadioGroupProps<T extends string | number> {
  name: string;
  ariaLabel: string;
  options: readonly RadioOption<T>[];
  value: T;
  onChange: (next: T) => void;
}

function RadioGroup<T extends string | number>({
  name,
  ariaLabel,
  options,
  value,
  onChange,
}: RadioGroupProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-col gap-1.5">
      {options.map((opt) => {
        const checked = value === opt.value;
        return (
          <label
            key={String(opt.value)}
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
              name={name}
              value={String(opt.value)}
              checked={checked}
              onChange={() => onChange(opt.value)}
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
                color: checked ? "var(--color-accent)" : "var(--color-text)",
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
  );
}

export function AppearanceTab() {
  const theme = useAppStore((s) => s.settings.theme);
  const fontScale = useAppStore((s) => s.settings.fontScale);
  const accent = useAppStore((s) => s.settings.accent);
  const density = useAppStore((s) => s.settings.density);
  const setSettings = useAppStore((s) => s.setSettings);

  const onThemeChange = async (next: ThemeMode) => {
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

  const onFontScaleChange = async (next: FontScale) => {
    setSettings({ fontScale: next });
    applyFontScale(next);
    try {
      await setFontScale(next);
    } catch {
      // Tauri-less / test environments — applyFontScale already wrote the
      // localStorage hint and the in-memory store update.
    }
  };

  const onAccentChange = async (next: AccentColor) => {
    setSettings({ accent: next });
    applyAccent(next);
    try {
      await setAccent(next);
    } catch {
      // Tauri-less / test environments — applyAccent already wrote the
      // localStorage hint and the in-memory store update.
    }
  };

  const onDensityChange = async (next: Density) => {
    setSettings({ density: next });
    applyDensity(next);
    try {
      await setDensity(next);
    } catch {
      // Tauri-less / test environments — applyDensity already wrote the
      // localStorage hint and the in-memory store update.
    }
  };

  return (
    <Stack>
      <H>Appearance</H>
      <Field
        label="Theme"
        hint="Changes apply immediately and persist across launches."
      >
        <RadioGroup
          name="theme"
          ariaLabel="Theme"
          options={THEME_OPTIONS}
          value={theme}
          onChange={(next) => void onThemeChange(next)}
        />
      </Field>
      <Field
        label="Accent"
        hint="Tints highlights, the unread dot, focus rings, and the sidebar selection."
      >
        <AccentChips
          value={accent}
          onChange={(next) => void onAccentChange(next)}
        />
      </Field>
      <Field
        label="Font size"
        hint="Scales the entire interface. Applies immediately and persists across launches."
      >
        <RadioGroup
          name="fontScale"
          ariaLabel="Font size"
          options={FONT_SCALE_OPTIONS}
          value={fontScale}
          onChange={(next) => void onFontScaleChange(next)}
        />
      </Field>
      <Field
        label="Density"
        hint="Controls the vertical padding on list rows."
      >
        <RadioGroup
          name="density"
          ariaLabel="Density"
          options={DENSITY_OPTIONS}
          value={density}
          onChange={(next) => void onDensityChange(next)}
        />
      </Field>
    </Stack>
  );
}
