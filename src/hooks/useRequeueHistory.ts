"use client";

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useAppStore } from "@/lib/store";

export interface RequeueHistory {
  count: number;
  optOut: boolean;
  // Toggles the per-PR opt-out and refreshes both values from the DB.
  setOptOut: (next: boolean) => Promise<void>;
}

const EMPTY = { count: 0, optOut: false };

async function readBoth(
  prId: string,
  headSha: string,
): Promise<{ count: number; optOut: boolean } | null> {
  try {
    const [count, optOut] = await Promise.all([
      invoke<number>("get_requeue_count", { prId, headSha }),
      invoke<boolean>("get_requeue_opt_out", { prId, headSha }),
    ]);
    return { count, optOut };
  } catch {
    // No Tauri host (tests, browser-only dev) — leave the badge blank.
    return null;
  }
}

/// Drives the "Auto-requeued N×" badge + opt-out toggle in the DetailPane
/// (#13). Re-reads from the SQLite-backed Tauri commands whenever the
/// (prId, headSha) pair changes OR a new poll cycle lands — a fresh requeue
/// attempt will only show up after the next `setPollResult` ticks.
export function useRequeueHistory(
  prId: string | null,
  headSha: string | null | undefined,
): RequeueHistory {
  const key = prId && headSha ? `${prId}|${headSha}` : null;

  const [state, setState] = useState(EMPTY);
  // Track the (prId, headSha) key the current `state` belongs to. If the
  // caller flips to a different PR, reset during render rather than in an
  // effect — keeps stale data from flashing one frame and satisfies the
  // "no setState in effect" rule.
  const [stateKey, setStateKey] = useState<string | null>(null);
  if (key !== stateKey) {
    setStateKey(key);
    setState(EMPTY);
  }

  // Re-fetch when a new poll cycle lands: the worker may have just attempted
  // a requeue, in which case the badge should bump to N+1.
  const lastPolledAt = useAppStore((s) => s.lastPolledAt);

  useEffect(() => {
    if (!prId || !headSha) return;
    let cancelled = false;
    void readBoth(prId, headSha).then((next) => {
      if (!cancelled && next) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [prId, headSha, lastPolledAt]);

  const setOptOut = useCallback(
    async (next: boolean) => {
      if (!prId || !headSha) return;
      try {
        await invoke("set_requeue_opt_out", {
          prId,
          headSha,
          optOut: next,
        });
      } catch {
        return;
      }
      const fresh = await readBoth(prId, headSha);
      if (fresh) setState(fresh);
    },
    [prId, headSha],
  );

  return { count: state.count, optOut: state.optOut, setOptOut };
}
