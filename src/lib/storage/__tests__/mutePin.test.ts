import { describe, it, expect, vi, beforeEach } from "vitest";

// Use the global invoke mock from setup.ts.
import { invoke } from "@tauri-apps/api/core";

import {
  listMutes,
  addMute,
  removeMute,
  listPins,
  addPin,
  removePin,
} from "../mutePin";

beforeEach(() => {
  vi.mocked(invoke).mockClear();
});

describe("listMutes", () => {
  it("returns rules from invoke", async () => {
    const rules = [{ scope: "repo", value: "owner/foo" }];
    vi.mocked(invoke).mockResolvedValueOnce(rules);
    const result = await listMutes();
    expect(invoke).toHaveBeenCalledWith("list_mutes");
    expect(result).toEqual(rules);
  });

  it("returns empty array on error", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("no db"));
    const result = await listMutes();
    expect(result).toEqual([]);
  });
});

describe("addMute", () => {
  it("invokes add_mute with correct args", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await addMute("repo", "owner/foo");
    expect(invoke).toHaveBeenCalledWith("add_mute", {
      scope: "repo",
      value: "owner/foo",
    });
  });
});

describe("removeMute", () => {
  it("invokes remove_mute with correct args", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await removeMute("org", "owner");
    expect(invoke).toHaveBeenCalledWith("remove_mute", {
      scope: "org",
      value: "owner",
    });
  });
});

describe("listPins", () => {
  it("returns pins from invoke", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["owner/foo", "owner/bar"]);
    const result = await listPins();
    expect(invoke).toHaveBeenCalledWith("list_pins");
    expect(result).toEqual(["owner/foo", "owner/bar"]);
  });

  it("returns empty array on error", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("no db"));
    const result = await listPins();
    expect(result).toEqual([]);
  });
});

describe("addPin / removePin", () => {
  it("invokes add_pin with correct args", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await addPin("owner/foo");
    expect(invoke).toHaveBeenCalledWith("add_pin", { value: "owner/foo" });
  });

  it("invokes remove_pin with correct args", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await removePin("owner/foo");
    expect(invoke).toHaveBeenCalledWith("remove_pin", { value: "owner/foo" });
  });
});
