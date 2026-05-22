import { describe, it, expect, vi, beforeEach } from "vitest";

// Use the global invoke mock from setup.ts rather than re-mocking.
import { invoke } from "@tauri-apps/api/core";

import { checkAndRecord } from "./notifications";

beforeEach(() => {
  vi.mocked(invoke).mockClear();
});

describe("checkAndRecord", () => {
  it("returns true on first key (INSERT succeeded)", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(true);
    const result = await checkAndRecord("eject:123:2024-01-01");
    expect(invoke).toHaveBeenCalledWith("check_and_record_notification", {
      dedupeKey: "eject:123:2024-01-01",
    });
    expect(result).toBe(true);
  });

  it("returns false on duplicate key (INSERT was ignored)", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(false);
    const result = await checkAndRecord("eject:123:2024-01-01");
    expect(result).toBe(false);
  });

  it("fails open — returns true if invoke throws", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("DB locked"));
    const result = await checkAndRecord("some-key");
    expect(result).toBe(true);
  });
});
