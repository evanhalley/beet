"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAppStore } from "@/lib/store";
import { loadSettings } from "@/lib/storage/settings";
import { listMutes, listPins } from "@/lib/storage/mutePin";
import { listSuppressions } from "@/lib/storage/suppress";
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
    Promise.all([loadSettings(), listMutes(), listPins(), listSuppressions()])
      .then(([settings, mutes, pins, suppressedIds]) => {
        if (cancelled) return;
        const store = useAppStore.getState();
        store.hydrateSettings(settings);
        store.setMutes(mutes);
        store.setPins(pins);
        store.setSuppressedIds(suppressedIds);
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
