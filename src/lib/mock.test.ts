import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { isMockMode } from "./mock";

const mockInvoke = vi.mocked(invoke);

describe("isMockMode", () => {
  it("returns the backend flag when the command resolves", async () => {
    mockInvoke.mockResolvedValueOnce(true);
    expect(await isMockMode()).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("is_mock_mode");
  });

  it("falls back to false when there's no Tauri host", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("no host"));
    expect(await isMockMode()).toBe(false);
  });
});
