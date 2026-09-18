"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ActionableItem, PrFilesResult } from "@/lib/types";

export interface UsePrFilesResult {
  data: PrFilesResult | null;
  isLoading: boolean;
  error: string | null;
}

/// Cache key for a PR's files: the item id plus its head SHA, so a new push
/// refetches while re-renders and view toggles never do.
export function prFilesKey(item: ActionableItem | null): string | null {
  if (!item?.pr) return null;
  return `${item.id}@${item.pr.headSha ?? ""}`;
}

const OWNED_BY_PARAM = "owned-by%5B%5D";

/// GitHub's Files changed tab with its "owned by" filter applied. The query
/// parameter mirrors what github.com writes when the filter is toggled.
export function ownedFilesUrl(prUrl: string, username: string): string {
  return `${prUrl}/files?${OWNED_BY_PARAM}=${encodeURIComponent(username)}`;
}

/// Deep link to one file's diff on the Files tab. Pass `ownedBy` only for
/// files the user owns, so the filter never hides the file just clicked.
export function diffUrl(prUrl: string, anchor: string, ownedBy?: string): string {
  const query = ownedBy ? `?${OWNED_BY_PARAM}=${encodeURIComponent(ownedBy)}` : "";
  return `${prUrl}/files${query}#${anchor}`;
}

// Result keyed by the PR key it's for; a mismatch reads as "loading" so no
// synchronous setState is needed inside the effect (mirrors useRunJobs).
interface KeyedResult {
  key: string | null;
  data: PrFilesResult | null;
  error: string | null;
}

const EMPTY: UsePrFilesResult = { data: null, isLoading: false, error: null };

/// Fetch the changed files + CODEOWNERS stake for the selected PR. No-op for
/// run rows. Re-fetches only when the PR or its head SHA changes; an
/// in-flight fetch for a previous selection is discarded.
export function usePrFiles(item: ActionableItem | null): UsePrFilesResult {
  const key = prFilesKey(item);
  const pr = item?.pr ?? null;
  const [owner, repo] = (item?.repoFullName ?? "").split("/");
  const number = pr?.number ?? 0;
  const headSha = pr?.headSha ?? null;
  const baseRef = pr?.baseRef ?? null;
  const baseSha = pr?.baseSha ?? null;

  const [result, setResult] = useState<KeyedResult>({
    key: null,
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    invoke<PrFilesResult>("fetch_pr_files_command", {
      owner,
      repo,
      number,
      headSha,
      baseRef,
      baseSha,
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
    // `key` already encodes the PR identity + head sha; the coordinates only
    // change alongside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return EMPTY;
  if (result.key !== key) return { data: null, isLoading: true, error: null };
  return { data: result.data, isLoading: false, error: result.error };
}
