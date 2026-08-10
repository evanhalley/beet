import { invoke } from "@tauri-apps/api/core";

// Per-item snooze, keyed by the stable ActionableItem id (e.g.
// "pr:owner/repo#42"). A snoozed item is hidden from the live sections until
// its `snoozed_until` timestamp passes. Mirrors the suppress storage wrapper;
// expired rows are purged Rust-side on each list.

interface SnoozeRow {
  item_id: string;
  snoozed_until: string;
}

/** ISO-8601 UTC timestamp `hours` from `now`, matching the Rust now_iso format. */
export function snoozeUntil(hours: number, now: number = Date.now()): string {
  return new Date(now + hours * 60 * 60 * 1000).toISOString();
}

export async function listSnoozes(): Promise<Record<string, string>> {
  try {
    const rows = await invoke<SnoozeRow[]>("list_snoozes");
    const map: Record<string, string> = {};
    for (const row of rows) map[row.item_id] = row.snoozed_until;
    return map;
  } catch {
    return {};
  }
}

export async function addSnooze(
  itemId: string,
  snoozedUntil: string,
): Promise<void> {
  await invoke("add_snooze", { itemId, snoozedUntil });
}

export async function removeSnooze(itemId: string): Promise<void> {
  await invoke("remove_snooze", { itemId });
}
