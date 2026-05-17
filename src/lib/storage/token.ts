import { invoke } from "@tauri-apps/api/core";

export async function storeToken(token: string): Promise<void> {
  await invoke("store_token", { token });
  await notifyTokenChanged();
}

export async function getToken(): Promise<string | null> {
  return (await invoke<string | null>("get_token")) ?? null;
}

export async function clearToken(): Promise<void> {
  await invoke("clear_token");
  await notifyTokenChanged();
}

// Tell the Rust poll loop the PAT was rotated/cleared so it drops its cached
// token and re-polls with the new credentials. Without this signal a newly-
// saved-but-still-valid token wouldn't take effect until an Unauthorized.
// Best-effort: in Tauri-less / test environments this is a no-op.
async function notifyTokenChanged(): Promise<void> {
  try {
    await invoke("notify_token_changed");
  } catch {
    // No Tauri host, or the poll loop isn't running yet — ignore.
  }
}

