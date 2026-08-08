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
  standaloneRunsAllowlist: "standaloneRunsAllowlist",
  notifyOnEjection: "notifyOnEjection",
  notifyOnFailingChecks: "notifyOnFailingChecks",
  notifyOnReviewRequest: "notifyOnReviewRequest",
  notifyOnMention: "notifyOnMention",
  notifyOnRunFinished: "notifyOnRunFinished",
  globalShortcutEnabled: "globalShortcutEnabled",
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
  // Per-repo workflow allowlist for the Standalone Runs section (#6 noise
  // control). Key = `owner/repo`, value = workflow names. Missing repo or
  // empty list = show all (already deduped per workflow). Non-empty list =
  // restrict that repo's standalone runs to just the listed workflows.
  standaloneRunsAllowlist: Record<string, string[]>;
  // §10 notification toggles — all on by default.
  notifyOnEjection: boolean;
  notifyOnFailingChecks: boolean;
  notifyOnReviewRequest: boolean;
  notifyOnMention: boolean;
  notifyOnRunFinished: boolean;
  // OS-level ⌥⇧B chord that toggles the tray popover from anywhere.
  globalShortcutEnabled: boolean;
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
  standaloneRunsAllowlist: {},
  notifyOnEjection: true,
  notifyOnFailingChecks: true,
  notifyOnReviewRequest: true,
  notifyOnMention: true,
  notifyOnRunFinished: true,
  globalShortcutEnabled: true,
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
    standaloneRunsAllowlistRaw,
    notifyOnEjection,
    notifyOnFailingChecks,
    notifyOnReviewRequest,
    notifyOnMention,
    notifyOnRunFinished,
    globalShortcutEnabled,
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
    getValue<unknown>(
      SETTINGS_KEYS.standaloneRunsAllowlist,
      SETTINGS_DEFAULTS.standaloneRunsAllowlist,
    ),
    getValue<boolean>(
      SETTINGS_KEYS.notifyOnEjection,
      SETTINGS_DEFAULTS.notifyOnEjection,
    ),
    getValue<boolean>(
      SETTINGS_KEYS.notifyOnFailingChecks,
      SETTINGS_DEFAULTS.notifyOnFailingChecks,
    ),
    getValue<boolean>(
      SETTINGS_KEYS.notifyOnReviewRequest,
      SETTINGS_DEFAULTS.notifyOnReviewRequest,
    ),
    getValue<boolean>(
      SETTINGS_KEYS.notifyOnMention,
      SETTINGS_DEFAULTS.notifyOnMention,
    ),
    getValue<boolean>(
      SETTINGS_KEYS.notifyOnRunFinished,
      SETTINGS_DEFAULTS.notifyOnRunFinished,
    ),
    getValue<boolean>(
      SETTINGS_KEYS.globalShortcutEnabled,
      SETTINGS_DEFAULTS.globalShortcutEnabled,
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
    standaloneRunsAllowlist: sanitizeStandaloneRunsAllowlist(
      standaloneRunsAllowlistRaw,
    ),
    notifyOnEjection,
    notifyOnFailingChecks,
    notifyOnReviewRequest,
    notifyOnMention,
    notifyOnRunFinished,
    globalShortcutEnabled,
  };
}

/// Coerce arbitrary stored JSON back into `Record<string, string[]>` so a
/// hand-edited config.json (or an older shape) can't crash the loader.
export function sanitizeStandaloneRunsAllowlist(
  raw: unknown,
): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [repo, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    out[repo] = value.filter((v): v is string => typeof v === "string");
  }
  return out;
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

export async function setStandaloneRunsAllowlist(
  value: Record<string, string[]>,
): Promise<void> {
  await setValue(SETTINGS_KEYS.standaloneRunsAllowlist, value);
  await notifyPollerConfigChanged();
}

// Notification toggles are frontend-only; no need to poke the poll loop.
export async function setNotifyOnEjection(value: boolean): Promise<void> {
  await setValue(SETTINGS_KEYS.notifyOnEjection, value);
}

export async function setNotifyOnFailingChecks(value: boolean): Promise<void> {
  await setValue(SETTINGS_KEYS.notifyOnFailingChecks, value);
}

export async function setNotifyOnReviewRequest(value: boolean): Promise<void> {
  await setValue(SETTINGS_KEYS.notifyOnReviewRequest, value);
}

export async function setNotifyOnMention(value: boolean): Promise<void> {
  await setValue(SETTINGS_KEYS.notifyOnMention, value);
}

export async function setNotifyOnRunFinished(value: boolean): Promise<void> {
  await setValue(SETTINGS_KEYS.notifyOnRunFinished, value);
}

// The chord is registered Rust-side, so flipping it pokes the backend to
// (un)register immediately — no restart needed. Best-effort outside Tauri.
export async function setGlobalShortcutEnabled(value: boolean): Promise<void> {
  await setValue(SETTINGS_KEYS.globalShortcutEnabled, value);
  try {
    await invoke("set_global_shortcut_enabled", { enabled: value });
  } catch {
    // No Tauri host — ignore.
  }
}

export function parseLineList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
