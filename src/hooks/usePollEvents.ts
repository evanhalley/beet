"use client";

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  useAppStore,
  type PollResultPayload,
  type PollStatusPayload,
} from "@/lib/store";

// Subscribes the frontend to the Rust poll loop's event stream and funnels both
// channels into the Zustand store. Mount once, near the app root.
//
// Set `pokeOnMount` to false in secondary windows (e.g. the tray popover) to
// avoid triggering a duplicate immediate poll cycle — the main window already
// pokes on first mount.
export function usePollEvents({ pokeOnMount = true } = {}): void {
  const setPollResult = useAppStore((s) => s.setPollResult);
  const setPollStatus = useAppStore((s) => s.setPollStatus);

  useEffect(() => {
    const resultPromise = listen<PollResultPayload>("poll:result", (event) => {
      setPollResult(event.payload);
    });
    const statusPromise = listen<PollStatusPayload>("poll:status", (event) => {
      setPollStatus(event.payload);
    });

    // The poll loop is spawned during Tauri setup() and immediately emits its
    // first cycle, which can fire before this hook subscribes (Tauri events
    // aren't replayed). After both listeners are registered, poke the loop
    // for an immediate poll so the UI populates on the first paint instead
    // of waiting out the interval.
    if (pokeOnMount) {
      Promise.all([resultPromise, statusPromise]).then(() => {
        invoke("refresh_now").catch(() => {
          // No Tauri host (tests) — ignore.
        });
      });
    }

    return () => {
      resultPromise.then((unlisten) => unlisten());
      statusPromise.then((unlisten) => unlisten());
    };
  }, [setPollResult, setPollStatus, pokeOnMount]);
}
