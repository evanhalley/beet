import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";

const LEGACY_STORE_FILE = "config.json";
const LEGACY_PAT_KEY = "github-pat";

export async function storeToken(token: string): Promise<void> {
  await invoke("store_token", { token });
}

export async function getToken(): Promise<string | null> {
  return (await invoke<string | null>("get_token")) ?? null;
}

export async function clearToken(): Promise<void> {
  await invoke("clear_token");
}

// Beet previously persisted the PAT as plaintext in config.json. The token now
// lives in the macOS Keychain; this scrubs any leftover plaintext copy on
// startup. Best-effort — a no-op when the store is unavailable (tests / non-Tauri).
export async function clearLegacyPlaintextToken(): Promise<void> {
  try {
    const store = await load(LEGACY_STORE_FILE, {
      autoSave: true,
      defaults: {},
    });
    if ((await store.get(LEGACY_PAT_KEY)) !== undefined) {
      await store.delete(LEGACY_PAT_KEY);
      await store.save();
    }
  } catch {
    // Store plugin unavailable — nothing to scrub.
  }
}
