import type { ThemeMode } from "@/lib/storage/settings";

// Localstorage hint so the inline script in <head> can set the right
// data-theme attribute before React mounts — avoids a flash of light content
// when the user has chosen dark. The Tauri-store value remains the source of
// truth for cross-session persistence; this is just a synchronous cache. It
// stores the *preference* ("system" included), not the resolved value.
export const THEME_LS_KEY = "beet.theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Collapse a preference into the concrete theme actually rendered.
 * "system" is resolved against the OS here (in JS) so the CSS only ever
 * needs a single `:root[data-theme="dark"]` block — no parallel
 * `@media (prefers-color-scheme: dark)` rule to keep in sync.
 */
export function resolveTheme(theme: ThemeMode): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolveTheme(theme));
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_LS_KEY, theme);
    }
  } catch {
    // localStorage may be unavailable in some embed contexts.
  }
}

/**
 * While the preference is "system", re-apply whenever the OS theme flips.
 * Returns an unsubscribe function. No-op outside the browser.
 */
export function watchSystemTheme(
  getPreference: () => ThemeMode,
): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(DARK_QUERY);
  const handler = () => {
    if (getPreference() === "system") applyTheme("system");
  };
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
