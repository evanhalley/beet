import { useAppStore } from "@/lib/store";

/**
 * Copy text to the system clipboard. Uses the async Clipboard API (available
 * in the Tauri webview as a secure context, and in dev browsers), with a
 * legacy execCommand fallback for older webviews. Returns whether it
 * succeeded; on failure it surfaces a UI error.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }

  try {
    if (typeof document !== "undefined") {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) return true;
    }
  } catch {
    // fall through to the error path
  }

  useAppStore.getState().setUiError("Couldn't copy to clipboard");
  return false;
}
