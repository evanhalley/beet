import { describe, test, expect, beforeEach } from "vitest";
import {
  AUTO_REQUEUE_MAX_ATTEMPTS_MAX,
  AUTO_REQUEUE_MAX_ATTEMPTS_MIN,
  SETTINGS_DEFAULTS,
  loadSettings,
  setAccent,
  setAutoRequeueEnabled,
  setAutoRequeueMaxAttempts,
  setAutoRequeueRepos,
  setDensity,
  setFontScale,
  setPenalizedBots,
  setPollingIntervalSec,
  setShowAllApproved,
  setTaskRegex,
  setGlobalShortcutEnabled,
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

  test("global shortcut is enabled by default", () => {
    expect(SETTINGS_DEFAULTS.globalShortcutEnabled).toBe(true);
  });

  test("setGlobalShortcutEnabled persists and notifies the Rust side", async () => {
    const { invoke } = (await import("@tauri-apps/api/core")) as unknown as {
      invoke: ReturnType<typeof import("vitest").vi.fn>;
    };

    await setGlobalShortcutEnabled(false);

    const settings = await loadSettings();
    expect(settings.globalShortcutEnabled).toBe(false);
    expect(invoke).toHaveBeenCalledWith("set_global_shortcut_enabled", {
      enabled: false,
    });
  });

  test("round-trips each setting", async () => {
    await setTeams(["acme/platform", "acme/api"]);
    await setPenalizedBots(["renovate[bot]"]);
    await setTaskRegex("/PROJ-\\d+/g");
    await setPollingIntervalSec(120);
    await setShowAllApproved(true);
    await setTheme("dark");
    await setFontScale(1.15);
    await setAccent("ocean");
    await setDensity("compact");

    const settings = await loadSettings();
    expect(settings.teams).toEqual(["acme/platform", "acme/api"]);
    expect(settings.penalizedBots).toEqual(["renovate[bot]"]);
    expect(settings.taskRegex).toBe("/PROJ-\\d+/g");
    expect(settings.pollingIntervalSec).toBe(120);
    expect(settings.showAllApproved).toBe(true);
    expect(settings.theme).toBe("dark");
    expect(settings.fontScale).toBe(1.15);
    expect(settings.accent).toBe("ocean");
    expect(settings.density).toBe("compact");
  });

  test("round-trips the auto-requeue settings", async () => {
    await setAutoRequeueEnabled(true);
    await setAutoRequeueMaxAttempts(3);
    await setAutoRequeueRepos(["acme/widgets", "acme/api"]);

    const settings = await loadSettings();
    expect(settings.autoRequeueEnabled).toBe(true);
    expect(settings.autoRequeueMaxAttempts).toBe(3);
    expect(settings.autoRequeueRepos).toEqual(["acme/widgets", "acme/api"]);
  });

  test("clamps autoRequeueMaxAttempts to [1, 5]", async () => {
    await setAutoRequeueMaxAttempts(99);
    expect((await loadSettings()).autoRequeueMaxAttempts).toBe(
      AUTO_REQUEUE_MAX_ATTEMPTS_MAX,
    );
    await setAutoRequeueMaxAttempts(0);
    expect((await loadSettings()).autoRequeueMaxAttempts).toBe(
      AUTO_REQUEUE_MAX_ATTEMPTS_MIN,
    );
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

  test("falls back to default accent when a corrupt value is stored", async () => {
    const mod = (await import("@tauri-apps/plugin-store")) as unknown as {
      __fakeStore: { set: (k: string, v: unknown) => Promise<void> };
    };
    await mod.__fakeStore.set("accent", "neon");

    const settings = await loadSettings();
    expect(settings.accent).toBe(SETTINGS_DEFAULTS.accent);
  });

  test("falls back to default density when a corrupt value is stored", async () => {
    const mod = (await import("@tauri-apps/plugin-store")) as unknown as {
      __fakeStore: { set: (k: string, v: unknown) => Promise<void> };
    };
    await mod.__fakeStore.set("density", "spacious");

    const settings = await loadSettings();
    expect(settings.density).toBe(SETTINGS_DEFAULTS.density);
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
