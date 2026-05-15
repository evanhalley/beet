"use client";

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  useAppStore,
  type PollResultPayload,
  type PollStatusPayload,
} from "@/lib/store";

// Subscribes the frontend to the Rust poll loop's event stream and funnels both
// channels into the Zustand store. Mount once, near the app root.
export function usePollEvents(): void {
  const setPollResult = useAppStore((s) => s.setPollResult);
  const setPollStatus = useAppStore((s) => s.setPollStatus);

  useEffect(() => {
    const resultPromise = listen<PollResultPayload>("poll:result", (event) => {
      setPollResult(event.payload);
    });
    const statusPromise = listen<PollStatusPayload>("poll:status", (event) => {
      setPollStatus(event.payload);
    });
    return () => {
      resultPromise.then((unlisten) => unlisten());
      statusPromise.then((unlisten) => unlisten());
    };
  }, [setPollResult, setPollStatus]);
}
