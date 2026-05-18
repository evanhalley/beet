import type {
  AccentColor,
  Density,
  FontScale,
  ThemeMode,
} from "@/lib/storage/settings";

// Localstorage hint so the inline script in <head> can set the right
// data-theme attribute before React mounts — avoids a flash of light content
// when the user has chosen dark. The Tauri-store value remains the source of
// truth for cross-session persistence; this is just a synchronous cache. It
// stores the *preference* ("system" included), not the resolved value.
export const THEME_LS_KEY = "beet.theme";

// Same purpose as THEME_LS_KEY, for the whole-UI zoom factor: lets the inline
// <head> script set --font-scale before React mounts so the UI doesn't render
// at 100% then jump. The Tauri-store value remains the source of truth.
export const FONT_SCALE_LS_KEY = "beet.fontScale";

// Same purpose as the keys above: lets the pre-hydration script set
// data-accent / data-density before first paint so a non-default selection
// doesn't briefly render with the wrong accent or row spacing.
export const ACCENT_LS_KEY = "beet.accent";
export const DENSITY_LS_KEY = "beet.density";

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
 * Apply the whole-UI zoom factor. Sets the --font-scale custom property on
 * <html>, which globals.css consumes via `:root { zoom: var(--font-scale) }`.
 */
export function applyFontScale(scale: FontScale): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--font-scale", String(scale));
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(FONT_SCALE_LS_KEY, String(scale));
    }
  } catch {
    // localStorage may be unavailable in some embed contexts.
  }
}

/**
 * Apply the accent hue. Sets data-accent on <html>, which globals.css uses
 * to swap --color-accent / --color-accent-soft / --color-accent-fg.
 */
export function applyAccent(accent: AccentColor): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-accent", accent);
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACCENT_LS_KEY, accent);
    }
  } catch {
    // localStorage may be unavailable in some embed contexts.
  }
}

/**
 * Apply the row-density preference. Sets data-density on <html>, which
 * globals.css uses to override --row-pad-y. "regular" leaves the attribute
 * unset so the default value from @theme applies.
 */
export function applyDensity(density: Density): void {
  if (typeof document === "undefined") return;
  if (density === "regular") {
    document.documentElement.removeAttribute("data-density");
  } else {
    document.documentElement.setAttribute("data-density", density);
  }
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DENSITY_LS_KEY, density);
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
