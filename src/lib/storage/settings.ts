import { load } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_TASK_REGEX } from "@/lib/tasks";

const STORE_FILE = "config.json";

export const SETTINGS_KEYS = {
  teams: "teams",
  penalizedBots: "penalizedBots",
  taskRegex: "taskRegex",
  pollingIntervalSec: "pollingIntervalSec",
  showAllApproved: "showAllApproved",
  theme: "theme",
  fontScale: "fontScale",
  accent: "accent",
  density: "density",
  autoRequeueEnabled: "autoRequeueEnabled",
  autoRequeueMaxAttempts: "autoRequeueMaxAttempts",
  autoRequeueRepos: "autoRequeueRepos",
} as const;

export const AUTO_REQUEUE_MAX_ATTEMPTS_MIN = 1;
export const AUTO_REQUEUE_MAX_ATTEMPTS_MAX = 5;

export type ThemeMode = "light" | "dark" | "system";

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

// Whole-UI zoom factor applied to the app root (see src/lib/theme.ts).
export type FontScale = 0.9 | 1 | 1.15 | 1.3;

export function isFontScale(value: unknown): value is FontScale {
  return value === 0.9 || value === 1 || value === 1.15 || value === 1.3;
}

// Accent hue applied via [data-accent] on <html> (see src/lib/theme.ts).
// Each value swaps --color-accent / --color-accent-soft / --color-accent-fg in
// globals.css; "beet" is the default and is a no-op selector.
export type AccentColor = "beet" | "ocean" | "forest" | "ink";

export function isAccentColor(value: unknown): value is AccentColor {
  return (
    value === "beet" ||
    value === "ocean" ||
    value === "forest" ||
    value === "ink"
  );
}

// Row spacing applied via [data-density] on <html>. "regular" matches the
// @theme default (--row-pad-y: 10px); the other two override that variable.
export type Density = "compact" | "regular" | "comfy";

export function isDensity(value: unknown): value is Density {
  return value === "compact" || value === "regular" || value === "comfy";
}

export interface BeetSettings {
  teams: string[];
  penalizedBots: string[];
  taskRegex: string;
  pollingIntervalSec: number;
  showAllApproved: boolean;
  theme: ThemeMode;
  fontScale: FontScale;
  accent: AccentColor;
  density: Density;
  // Issue #13. Off by default; the user must opt in via Settings → Merge Queue.
  autoRequeueEnabled: boolean;
  autoRequeueMaxAttempts: number;
  // Optional `owner/repo` allowlist. Empty = all repos.
  autoRequeueRepos: string[];
}

export const SETTINGS_DEFAULTS: BeetSettings = {
  teams: [],
  penalizedBots: [],
  taskRegex: DEFAULT_TASK_REGEX,
  pollingIntervalSec: 60,
  showAllApproved: false,
  theme: "system",
  fontScale: 1,
  accent: "beet",
  density: "regular",
  autoRequeueEnabled: false,
  autoRequeueMaxAttempts: 2,
  autoRequeueRepos: [],
};

function clampMaxAttempts(n: number): number {
  if (!Number.isFinite(n)) return SETTINGS_DEFAULTS.autoRequeueMaxAttempts;
  return Math.min(
    AUTO_REQUEUE_MAX_ATTEMPTS_MAX,
    Math.max(AUTO_REQUEUE_MAX_ATTEMPTS_MIN, Math.round(n)),
  );
}

async function getStore() {
  return load(STORE_FILE, { autoSave: true, defaults: {} });
}

async function getValue<T>(key: string, fallback: T): Promise<T> {
  try {
    const store = await getStore();
    const value = await store.get<T>(key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

async function setValue<T>(key: string, value: T): Promise<void> {
  const store = await getStore();
  await store.set(key, value);
  await store.save();
}

// Tell the Rust poll loop to re-read config.json and poll immediately, so a
// settings change takes effect without an app restart. Best-effort: a no-op in
// Tauri-less / test environments, or before the poll loop has started.
async function notifyPollerConfigChanged(): Promise<void> {
  try {
    await invoke("update_poll_config");
  } catch {
    // No Tauri host, or the poll loop isn't running yet — ignore.
  }
}

export async function loadSettings(): Promise<BeetSettings> {
  const [
    teams,
    penalizedBots,
    taskRegex,
    pollingIntervalSec,
    showAllApproved,
    themeRaw,
    fontScaleRaw,
    accentRaw,
    densityRaw,
    autoRequeueEnabled,
    autoRequeueMaxAttemptsRaw,
    autoRequeueRepos,
  ] = await Promise.all([
    getValue<string[]>(SETTINGS_KEYS.teams, SETTINGS_DEFAULTS.teams),
    getValue<string[]>(
      SETTINGS_KEYS.penalizedBots,
      SETTINGS_DEFAULTS.penalizedBots,
    ),
    getValue<string>(SETTINGS_KEYS.taskRegex, SETTINGS_DEFAULTS.taskRegex),
    getValue<number>(
      SETTINGS_KEYS.pollingIntervalSec,
      SETTINGS_DEFAULTS.pollingIntervalSec,
    ),
    getValue<boolean>(
      SETTINGS_KEYS.showAllApproved,
      SETTINGS_DEFAULTS.showAllApproved,
    ),
    getValue<unknown>(SETTINGS_KEYS.theme, SETTINGS_DEFAULTS.theme),
    getValue<unknown>(SETTINGS_KEYS.fontScale, SETTINGS_DEFAULTS.fontScale),
    getValue<unknown>(SETTINGS_KEYS.accent, SETTINGS_DEFAULTS.accent),
    getValue<unknown>(SETTINGS_KEYS.density, SETTINGS_DEFAULTS.density),
    getValue<boolean>(
      SETTINGS_KEYS.autoRequeueEnabled,
      SETTINGS_DEFAULTS.autoRequeueEnabled,
    ),
    getValue<number>(
      SETTINGS_KEYS.autoRequeueMaxAttempts,
      SETTINGS_DEFAULTS.autoRequeueMaxAttempts,
    ),
    getValue<string[]>(
      SETTINGS_KEYS.autoRequeueRepos,
      SETTINGS_DEFAULTS.autoRequeueRepos,
    ),
  ]);
  const theme = isThemeMode(themeRaw) ? themeRaw : SETTINGS_DEFAULTS.theme;
  const fontScale = isFontScale(fontScaleRaw)
    ? fontScaleRaw
    : SETTINGS_DEFAULTS.fontScale;
  const accent = isAccentColor(accentRaw) ? accentRaw : SETTINGS_DEFAULTS.accent;
  const density = isDensity(densityRaw) ? densityRaw : SETTINGS_DEFAULTS.density;
  return {
    teams,
    penalizedBots,
    taskRegex,
    pollingIntervalSec,
    showAllApproved,
    theme,
    fontScale,
    accent,
    density,
    autoRequeueEnabled,
    autoRequeueMaxAttempts: clampMaxAttempts(autoRequeueMaxAttemptsRaw),
    autoRequeueRepos,
  };
}

// These four feed the Rust poll loop, so each notifies it after persisting.
export async function setTeams(value: string[]): Promise<void> {
  await setValue(SETTINGS_KEYS.teams, value);
  await notifyPollerConfigChanged();
}

export async function setPenalizedBots(value: string[]): Promise<void> {
  await setValue(SETTINGS_KEYS.penalizedBots, value);
  await notifyPollerConfigChanged();
}

export async function setTaskRegex(value: string): Promise<void> {
  await setValue(SETTINGS_KEYS.taskRegex, value);
  await notifyPollerConfigChanged();
}

export async function setPollingIntervalSec(value: number): Promise<void> {
  await setValue(SETTINGS_KEYS.pollingIntervalSec, value);
  await notifyPollerConfigChanged();
}

// showAllApproved only affects frontend visibility filtering — the poll loop
// never sees it, so no notification is needed.
export async function setShowAllApproved(value: boolean): Promise<void> {
  await setValue(SETTINGS_KEYS.showAllApproved, value);
}

export async function setTheme(value: ThemeMode): Promise<void> {
  await setValue(SETTINGS_KEYS.theme, value);
}

export async function setFontScale(value: FontScale): Promise<void> {
  await setValue(SETTINGS_KEYS.fontScale, value);
}

export async function setAccent(value: AccentColor): Promise<void> {
  await setValue(SETTINGS_KEYS.accent, value);
}

export async function setDensity(value: Density): Promise<void> {
  await setValue(SETTINGS_KEYS.density, value);
}

// Auto-requeue settings flow into the Rust poll loop's PollConfig, so each
// setter pokes the loop after persisting (same pattern as teams/bots/etc.).
export async function setAutoRequeueEnabled(value: boolean): Promise<void> {
  await setValue(SETTINGS_KEYS.autoRequeueEnabled, value);
  await notifyPollerConfigChanged();
}

export async function setAutoRequeueMaxAttempts(value: number): Promise<void> {
  const clamped = clampMaxAttempts(value);
  await setValue(SETTINGS_KEYS.autoRequeueMaxAttempts, clamped);
  await notifyPollerConfigChanged();
}

export async function setAutoRequeueRepos(value: string[]): Promise<void> {
  await setValue(SETTINGS_KEYS.autoRequeueRepos, value);
  await notifyPollerConfigChanged();
}

export function parseLineList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
