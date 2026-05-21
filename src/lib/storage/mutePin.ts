import { invoke } from "@tauri-apps/api/core";

export interface MuteRule {
  scope: "repo" | "org";
  value: string; // "owner/repo" or "owner"
}

export async function listMutes(): Promise<MuteRule[]> {
  try {
    return await invoke<MuteRule[]>("list_mutes");
  } catch {
    return [];
  }
}

export async function addMute(
  scope: MuteRule["scope"],
  value: string,
): Promise<void> {
  await invoke("add_mute", { scope, value });
}

export async function removeMute(
  scope: MuteRule["scope"],
  value: string,
): Promise<void> {
  await invoke("remove_mute", { scope, value });
}

export async function listPins(): Promise<string[]> {
  try {
    return await invoke<string[]>("list_pins");
  } catch {
    return [];
  }
}

export async function addPin(value: string): Promise<void> {
  await invoke("add_pin", { value });
}

export async function removePin(value: string): Promise<void> {
  await invoke("remove_pin", { value });
}
