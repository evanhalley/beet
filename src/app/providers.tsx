"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAppStore } from "@/lib/store";
import { loadSettings } from "@/lib/storage/settings";
import {
  applyAccent,
  applyDensity,
  applyFontScale,
  applyTheme,
  watchSystemTheme,
} from "@/lib/theme";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  useEffect(() => {
    let cancelled = false;
    loadSettings()
      .then((settings) => {
        if (cancelled) return;
        useAppStore.getState().hydrateSettings(settings);
        applyTheme(settings.theme);
        applyFontScale(settings.fontScale);
        applyAccent(settings.accent);
        applyDensity(settings.density);
      })
      .catch(() => {
        // Tauri-less / test environments fall back to defaults already in the store.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // While the preference is "system", track live OS theme changes.
  useEffect(() => {
    return watchSystemTheme(() => useAppStore.getState().settings.theme);
  }, []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
