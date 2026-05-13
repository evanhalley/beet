import { useAppStore } from "@/lib/store";

export async function openInBrowser(url: string): Promise<void> {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
    return;
  } catch (tauriErr) {
    if (typeof window !== "undefined") {
      try {
        const w = window.open(url, "_blank", "noopener,noreferrer");
        if (w) return;
      } catch {
        // fall through
      }
    }
    console.error("openInBrowser failed", tauriErr);
    useAppStore.getState().setUiError(`Couldn't open ${url}`);
  }
}
