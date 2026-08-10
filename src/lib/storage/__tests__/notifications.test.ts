import { describe, it, expect, vi, beforeEach } from "vitest";

// Use the global invoke mock from setup.ts rather than re-mocking.
import { invoke } from "@tauri-apps/api/core";

import {
  checkAndRecord,
  getNotificationLink,
  notifIdFromKey,
  recordNotificationLink,
} from "../notifications";

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

describe("notifIdFromKey", () => {
  it("is deterministic and positive within 32-bit range", () => {
    const a = notifIdFromKey("review-req:pr:acme/repo#1");
    const b = notifIdFromKey("review-req:pr:acme/repo#1");
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0x7fffffff);
    expect(Number.isInteger(a)).toBe(true);
  });

  it("differs for different keys", () => {
    expect(notifIdFromKey("review-req:pr:acme/repo#1")).not.toBe(
      notifIdFromKey("review-req:pr:acme/repo#2"),
    );
  });
});

describe("notification link map", () => {
  it("records a link by numeric id", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await recordNotificationLink(123, "pr:acme/repo#7");
    expect(invoke).toHaveBeenCalledWith("record_notification_link", {
      notifId: 123,
      itemId: "pr:acme/repo#7",
    });
  });

  it("resolves a link, returning null when unknown", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("pr:acme/repo#7");
    await expect(getNotificationLink(123)).resolves.toBe("pr:acme/repo#7");

    vi.mocked(invoke).mockResolvedValueOnce(null);
    await expect(getNotificationLink(999)).resolves.toBeNull();
  });

  it("getNotificationLink fails safe to null if invoke throws", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("DB locked"));
    await expect(getNotificationLink(1)).resolves.toBeNull();
  });
});
