import { load } from "@tauri-apps/plugin-store";
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
} as const;

export type ThemeMode = "light" | "dark" | "system";

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

// Whole-UI zoom factor applied to the app root (see src/lib/theme.ts).
export type FontScale = 0.9 | 1 | 1.15 | 1.3;

export function isFontScale(value: unknown): value is FontScale {
  return value === 0.9 || value === 1 || value === 1.15 || value === 1.3;
}

export interface BeetSettings {
  teams: string[];
  penalizedBots: string[];
  taskRegex: string;
  pollingIntervalSec: number;
  showAllApproved: boolean;
  theme: ThemeMode;
  fontScale: FontScale;
}

export const SETTINGS_DEFAULTS: BeetSettings = {
  teams: [],
  penalizedBots: [],
  taskRegex: DEFAULT_TASK_REGEX,
  pollingIntervalSec: 60,
  showAllApproved: false,
  theme: "system",
  fontScale: 1,
};

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

export async function loadSettings(): Promise<BeetSettings> {
  const [
    teams,
    penalizedBots,
    taskRegex,
    pollingIntervalSec,
    showAllApproved,
    themeRaw,
    fontScaleRaw,
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
  ]);
  const theme = isThemeMode(themeRaw) ? themeRaw : SETTINGS_DEFAULTS.theme;
  const fontScale = isFontScale(fontScaleRaw)
    ? fontScaleRaw
    : SETTINGS_DEFAULTS.fontScale;
  return {
    teams,
    penalizedBots,
    taskRegex,
    pollingIntervalSec,
    showAllApproved,
    theme,
    fontScale,
  };
}

export async function setTeams(value: string[]): Promise<void> {
  await setValue(SETTINGS_KEYS.teams, value);
}

export async function setPenalizedBots(value: string[]): Promise<void> {
  await setValue(SETTINGS_KEYS.penalizedBots, value);
}

export async function setTaskRegex(value: string): Promise<void> {
  await setValue(SETTINGS_KEYS.taskRegex, value);
}

export async function setPollingIntervalSec(value: number): Promise<void> {
  await setValue(SETTINGS_KEYS.pollingIntervalSec, value);
}

export async function setShowAllApproved(value: boolean): Promise<void> {
  await setValue(SETTINGS_KEYS.showAllApproved, value);
}

export async function setTheme(value: ThemeMode): Promise<void> {
  await setValue(SETTINGS_KEYS.theme, value);
}

export async function setFontScale(value: FontScale): Promise<void> {
  await setValue(SETTINGS_KEYS.fontScale, value);
}

export function parseLineList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
