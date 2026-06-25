import { invoke } from "@tauri-apps/api/core";

// Per-PR suppression, keyed by the stable ActionableItem id (e.g.
// "pr:owner/repo#42"). A suppressed PR is hidden from the Review Requests list
// unless "Show all" is on. Mirrors the mute/pin storage wrapper.

export async function listSuppressions(): Promise<string[]> {
  try {
    return await invoke<string[]>("list_suppressions");
  } catch {
    return [];
  }
}

export async function addSuppression(itemId: string): Promise<void> {
  await invoke("add_suppression", { itemId });
}

export async function removeSuppression(itemId: string): Promise<void> {
  await invoke("remove_suppression", { itemId });
}
