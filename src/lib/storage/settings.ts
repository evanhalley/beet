import { load } from "@tauri-apps/plugin-store";
import { DEFAULT_TASK_REGEX } from "@/lib/tasks";

const STORE_FILE = "config.json";

export const SETTINGS_KEYS = {
  teams: "teams",
  penalizedBots: "penalizedBots",
  taskRegex: "taskRegex",
  pollingIntervalSec: "pollingIntervalSec",
  showAllApproved: "showAllApproved",
} as const;

export interface BeetSettings {
  teams: string[];
  penalizedBots: string[];
  taskRegex: string;
  pollingIntervalSec: number;
  showAllApproved: boolean;
}

export const SETTINGS_DEFAULTS: BeetSettings = {
  teams: [],
  penalizedBots: [],
  taskRegex: DEFAULT_TASK_REGEX,
  pollingIntervalSec: 60,
  showAllApproved: false,
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
  const [teams, penalizedBots, taskRegex, pollingIntervalSec, showAllApproved] =
    await Promise.all([
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
    ]);
  return { teams, penalizedBots, taskRegex, pollingIntervalSec, showAllApproved };
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

export function parseLineList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
