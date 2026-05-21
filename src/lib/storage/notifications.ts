import { invoke } from "@tauri-apps/api/core";

// Atomically checks whether `dedupeKey` has been seen before, and if not,
// records it. Returns `true` only the first time a given key is presented.
// Fails open (returns true) so a SQLite error doesn't silently swallow
// notifications — better to fire one duplicate than to miss them all.
export async function checkAndRecord(dedupeKey: string): Promise<boolean> {
  try {
    return await invoke<boolean>("check_and_record_notification", {
      dedupeKey,
    });
  } catch {
    return true;
  }
}
