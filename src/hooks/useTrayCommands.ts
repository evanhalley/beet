"use client";

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "@/lib/store";

export function useTrayCommands(): void {
  const setPaused = useAppStore((s) => s.setPaused);

  useEffect(() => {
    const listeners = [
      listen<boolean>("tray:toggle-pause", (event) => {
        setPaused(event.payload);
      }),
    ];

    return () => {
      for (const p of listeners) {
        p.then((unlisten) => unlisten());
      }
    };
  }, [setPaused]);
}
