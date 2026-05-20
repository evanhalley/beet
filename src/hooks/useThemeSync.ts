"use client";

import { useEffect } from "react";
import {
  THEME_LS_KEY,
  FONT_SCALE_LS_KEY,
  ACCENT_LS_KEY,
  DENSITY_LS_KEY,
  applyTheme,
  applyFontScale,
  applyAccent,
  applyDensity,
} from "@/lib/theme";
import type { ThemeMode, FontScale, AccentColor, Density } from "@/lib/storage/settings";

const VALID_THEMES = new Set(["light", "dark", "system"]);
const VALID_SCALES = new Set(["0.9", "1", "1.15", "1.3"]);
const VALID_ACCENTS = new Set(["beet", "ocean", "forest", "ink"]);
const VALID_DENSITIES = new Set(["compact", "regular", "comfy"]);

/**
 * Listen for cross-window localStorage writes and re-apply appearance
 * settings. The `storage` event fires only in *other* windows on the
 * same origin, so when the main window updates the theme the tray
 * window picks it up immediately (and vice-versa).
 */
export function useThemeSync(): void {
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (!e.newValue) return;

      switch (e.key) {
        case THEME_LS_KEY:
          if (VALID_THEMES.has(e.newValue)) {
            applyTheme(e.newValue as ThemeMode);
          }
          break;
        case FONT_SCALE_LS_KEY:
          if (VALID_SCALES.has(e.newValue)) {
            applyFontScale(Number(e.newValue) as FontScale);
          }
          break;
        case ACCENT_LS_KEY:
          if (VALID_ACCENTS.has(e.newValue)) {
            applyAccent(e.newValue as AccentColor);
          }
          break;
        case DENSITY_LS_KEY:
          if (VALID_DENSITIES.has(e.newValue)) {
            applyDensity(e.newValue as Density);
          }
          break;
      }
    }

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
}
