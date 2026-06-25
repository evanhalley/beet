import { invoke } from "@tauri-apps/api/core";

// Whether the Rust process was launched with `BEET_MOCK=1` (demo / offline
// mode). When true, the poll loop emits a static fixture instead of hitting
// GitHub, and the frontend suppresses the missing-token banner so the populated
// UI renders without a PAT. Returns false when there's no Tauri host
// (tests / browser-less), matching the swallow-and-default pattern used in
// usePollEvents.
export async function isMockMode(): Promise<boolean> {
  try {
    return await invoke<boolean>("is_mock_mode");
  } catch {
    return false;
  }
}
