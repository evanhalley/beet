"use client";

import { useState, useEffect } from "react";

export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        // Not running in Tauri (e.g. browser dev, tests) — leave blank.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return version;
}
