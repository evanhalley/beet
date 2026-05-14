import type { ThemeMode } from "@/lib/storage/settings";

// Localstorage hint so the inline script in <head> can set the right
// data-theme attribute before React mounts — avoids a flash of light content
// when the user has chosen dark. The Tauri-store value remains the source of
// truth for cross-session persistence; this is just a synchronous cache.
export const THEME_LS_KEY = "beet.theme";

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_LS_KEY, theme);
    }
  } catch {
    // localStorage may be unavailable in some embed contexts.
  }
}
