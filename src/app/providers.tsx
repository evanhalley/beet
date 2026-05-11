"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setRateLimitListener } from "@/lib/github/octokit";
import { useAppStore } from "@/lib/store";
import { loadSettings } from "@/lib/storage/settings";

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
    const setRateLimit = useAppStore.getState().setRateLimit;
    setRateLimitListener((rl) => {
      if (rl) setRateLimit(rl);
    });
    return () => setRateLimitListener(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadSettings()
      .then((settings) => {
        if (!cancelled) useAppStore.getState().hydrateSettings(settings);
      })
      .catch(() => {
        // Tauri-less / test environments fall back to defaults already in the store.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
