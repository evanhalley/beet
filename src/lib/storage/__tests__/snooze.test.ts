import { describe, expect, test, vi } from "vitest";
import { addSnooze, listSnoozes, removeSnooze, snoozeUntil } from "../snooze";

describe("snoozeUntil", () => {
  const now = Date.parse("2026-08-08T12:00:00.000Z");

  test("adds whole hours in ISO-8601 UTC with millisecond precision", () => {
    expect(snoozeUntil(1, now)).toBe("2026-08-08T13:00:00.000Z");
    expect(snoozeUntil(4, now)).toBe("2026-08-08T16:00:00.000Z");
    expect(snoozeUntil(24, now)).toBe("2026-08-09T12:00:00.000Z");
  });
});

describe("snooze storage wrapper", () => {
  test("listSnoozes folds rows into an id → until map", async () => {
    const { invoke } = (await import("@tauri-apps/api/core")) as unknown as {
      invoke: ReturnType<typeof vi.fn>;
    };
    invoke.mockResolvedValueOnce([
      { item_id: "pr:acme/repo#1", snoozed_until: "2099-01-01T00:00:00.000Z" },
      { item_id: "pr:acme/repo#2", snoozed_until: "2099-02-01T00:00:00.000Z" },
    ]);

    const map = await listSnoozes();

    expect(map).toEqual({
      "pr:acme/repo#1": "2099-01-01T00:00:00.000Z",
      "pr:acme/repo#2": "2099-02-01T00:00:00.000Z",
    });
  });

  test("listSnoozes returns an empty map outside Tauri", async () => {
    const { invoke } = (await import("@tauri-apps/api/core")) as unknown as {
      invoke: ReturnType<typeof vi.fn>;
    };
    invoke.mockRejectedValueOnce(new Error("no tauri"));

    expect(await listSnoozes()).toEqual({});
  });

  test("addSnooze and removeSnooze pass the item id through", async () => {
    const { invoke } = (await import("@tauri-apps/api/core")) as unknown as {
      invoke: ReturnType<typeof vi.fn>;
    };

    await addSnooze("pr:acme/repo#1", "2099-01-01T00:00:00.000Z");
    expect(invoke).toHaveBeenCalledWith("add_snooze", {
      itemId: "pr:acme/repo#1",
      snoozedUntil: "2099-01-01T00:00:00.000Z",
    });

    await removeSnooze("pr:acme/repo#1");
    expect(invoke).toHaveBeenCalledWith("remove_snooze", {
      itemId: "pr:acme/repo#1",
    });
  });
});
