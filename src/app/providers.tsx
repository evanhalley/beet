"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setRateLimitListener } from "@/lib/github/octokit";
import { useAppStore } from "@/lib/store";
import { loadSettings } from "@/lib/storage/settings";
import { clearCache } from "@/lib/storage/etag-cache";

// Bump when ETag cache shape or write semantics change. On a mismatch the
// existing cache is dropped once and the new version is recorded.
const CACHE_SCHEMA_VERSION = "2026-05-11";
const CACHE_VERSION_KEY = "beet.etagCacheVersion";

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(CACHE_VERSION_KEY);
      if (stored === CACHE_SCHEMA_VERSION) return;
      clearCache()
        .then(() =>
          window.localStorage.setItem(CACHE_VERSION_KEY, CACHE_SCHEMA_VERSION),
        )
        .catch(() => {
          // Tauri-less / test environments — nothing to clear.
        });
    } catch {
      // localStorage may be unavailable in some embed contexts.
    }
  }, []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
