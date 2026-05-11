import { describe, test, expect, beforeEach } from "vitest";
import {
  SETTINGS_DEFAULTS,
  loadSettings,
  setPenalizedBots,
  setPollingIntervalSec,
  setShowAllApproved,
  setTaskRegex,
  setTeams,
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

    const settings = await loadSettings();
    expect(settings.teams).toEqual(["acme/platform", "acme/api"]);
    expect(settings.penalizedBots).toEqual(["renovate[bot]"]);
    expect(settings.taskRegex).toBe("/PROJ-\\d+/g");
    expect(settings.pollingIntervalSec).toBe(120);
    expect(settings.showAllApproved).toBe(true);
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
