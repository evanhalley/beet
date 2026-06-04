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

// Derive a stable, positive 32-bit id from a notification's dedupe key. The
// macOS notifications plugin only round-trips the numeric `id` on click (the
// `extra` payload is dropped), so we key the id→item map on this. Deterministic
// so a re-fired notification reuses its id and updates the same row.
export function notifIdFromKey(dedupeKey: string): number {
  // FNV-1a 32-bit, masked to 31 bits to stay positive within i32 range.
  let hash = 0x811c9dc5;
  for (let i = 0; i < dedupeKey.length; i++) {
    hash ^= dedupeKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) & 0x7fffffff;
}

// Persist which ActionableItem a fired notification points at, keyed by its
// numeric id, so the click handler can resolve and select it. Fails silently —
// a missing link just means the click falls back to foregrounding the app.
export async function recordNotificationLink(
  notifId: number,
  itemId: string,
): Promise<void> {
  try {
    await invoke("record_notification_link", { notifId, itemId });
  } catch {
    // Not in Tauri, or DB error — ignore.
  }
}

// Resolve the ActionableItem id for a clicked notification's numeric id.
export async function getNotificationLink(
  notifId: number,
): Promise<string | null> {
  try {
    return (await invoke<string | null>("get_notification_link", { notifId })) ?? null;
  } catch {
    return null;
  }
}
