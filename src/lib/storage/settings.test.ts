import { describe, test, expect, beforeEach } from "vitest";
import {
  SETTINGS_DEFAULTS,
  loadSettings,
  setFontScale,
  setPenalizedBots,
  setPollingIntervalSec,
  setShowAllApproved,
  setTaskRegex,
  setTeams,
  setTheme,
  parseLineList,
} from "./settings";

describe("settings storage", () => {
  beforeEach(async () => {
    const mod = (await import("@tauri-apps/plugin-store")) as unknown as {
      __fakeStore: { __reset: () => void };
    };
    mod.__fakeStore.__reset();
  });

  test("loadSettings returns defaults when nothing is persisted", async () => {
    const settings = await loadSettings();
    expect(settings).toEqual(SETTINGS_DEFAULTS);
  });

  test("round-trips each setting", async () => {
    await setTeams(["acme/platform", "acme/api"]);
    await setPenalizedBots(["renovate[bot]"]);
    await setTaskRegex("/PROJ-\\d+/g");
    await setPollingIntervalSec(120);
    await setShowAllApproved(true);
    await setTheme("dark");
    await setFontScale(1.15);

    const settings = await loadSettings();
    expect(settings.teams).toEqual(["acme/platform", "acme/api"]);
    expect(settings.penalizedBots).toEqual(["renovate[bot]"]);
    expect(settings.taskRegex).toBe("/PROJ-\\d+/g");
    expect(settings.pollingIntervalSec).toBe(120);
    expect(settings.showAllApproved).toBe(true);
    expect(settings.theme).toBe("dark");
    expect(settings.fontScale).toBe(1.15);
  });

  test("falls back to 'system' when a corrupt theme value is stored", async () => {
    const mod = (await import("@tauri-apps/plugin-store")) as unknown as {
      __fakeStore: { set: (k: string, v: unknown) => Promise<void> };
    };
    await mod.__fakeStore.set("theme", "magenta");

    const settings = await loadSettings();
    expect(settings.theme).toBe("system");
  });

  test("falls back to default font scale when a corrupt value is stored", async () => {
    const mod = (await import("@tauri-apps/plugin-store")) as unknown as {
      __fakeStore: { set: (k: string, v: unknown) => Promise<void> };
    };
    await mod.__fakeStore.set("fontScale", 2.5);

    const settings = await loadSettings();
    expect(settings.fontScale).toBe(SETTINGS_DEFAULTS.fontScale);
  });
});

describe("parseLineList", () => {
  test("trims and drops empty lines", () => {
    expect(parseLineList("  acme/api  \n\n  acme/web ")).toEqual([
      "acme/api",
      "acme/web",
    ]);
    expect(parseLineList("")).toEqual([]);
  });
});
