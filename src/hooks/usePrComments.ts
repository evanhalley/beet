"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ActionableItem, PrCommentsResult } from "@/lib/types";

export interface UsePrCommentsResult {
  data: PrCommentsResult | null;
  isLoading: boolean;
  error: string | null;
}

/// Cache key for a PR's comments: the item id plus its `updatedAt`. A new
/// comment bumps the PR's updated_at, so the next poll refetches; re-renders
/// and re-selecting the same PR don't. The Rust side is ETag-cached anyway.
export function prCommentsKey(item: ActionableItem | null): string | null {
  if (!item?.pr) return null;
  return `${item.id}@${item.updatedAt}`;
}

// Result keyed by the PR key it's for; a mismatch reads as "loading" so no
// synchronous setState is needed inside the effect (mirrors usePrFiles).
interface KeyedResult {
  key: string | null;
  data: PrCommentsResult | null;
  error: string | null;
}

const EMPTY: UsePrCommentsResult = { data: null, isLoading: false, error: null };

/// Fetch the conversation + review comments for the selected PR — the
/// detail-pane-only fallback of the mentions hybrid (SPECS §7). Never called
/// for off-screen PRs. No-op for run rows.
export function usePrComments(item: ActionableItem | null): UsePrCommentsResult {
  const key = prCommentsKey(item);
  const [owner, repo] = (item?.repoFullName ?? "").split("/");
  const number = item?.pr?.number ?? 0;

  const [result, setResult] = useState<KeyedResult>({
    key: null,
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    invoke<PrCommentsResult>("fetch_pr_comments_command", {
      owner,
      repo,
      number,
    })
      .then((data) => {
        if (cancelled) return;
        setResult({ key, data, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setResult({ key, data: null, error: message });
      });
    return () => {
      cancelled = true;
    };
    // `key` already encodes the PR identity; the coordinates only change
    // alongside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return EMPTY;
  if (result.key !== key) {
    // Keep showing the previous comments for the same PR while a refetch
    // (new updatedAt) is in flight, instead of flashing the skeleton.
    const samePr = result.key?.split("@")[0] === item?.id;
    if (samePr && result.data) {
      return { data: result.data, isLoading: false, error: null };
    }
    return { data: null, isLoading: true, error: null };
  }
  return { data: result.data, isLoading: false, error: result.error };
}
