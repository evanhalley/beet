"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ActionableItem, WorkflowJobSummary } from "@/lib/types";

export interface UseRunJobsResult {
  jobs: WorkflowJobSummary[];
  isLoading: boolean;
  error: string | null;
}

/// Parse the `run:{owner}/{repo}#{runId}` id Beet assigns to standalone-run
/// items. Returns null when the id isn't in that shape (e.g. a PR row was
/// passed in).
export function parseRunItemId(
  id: string,
): { owner: string; repo: string; runId: number } | null {
  const rest = id.startsWith("run:") ? id.slice(4) : null;
  if (!rest) return null;
  const hash = rest.lastIndexOf("#");
  if (hash === -1) return null;
  const repoFull = rest.slice(0, hash);
  const runIdStr = rest.slice(hash + 1);
  const [owner, repo] = repoFull.split("/");
  const runId = Number(runIdStr);
  if (!owner || !repo || !Number.isFinite(runId)) return null;
  return { owner, repo, runId };
}

// Result keyed by the run id it's for. The hook treats a mismatch between
// the current `id` and `result.id` as "still loading", which lets us avoid
// a synchronous setState inside the effect (the react-hooks/set-state-in-
// effect rule flags those).
interface KeyedResult {
  id: string | null;
  jobs: WorkflowJobSummary[];
  error: string | null;
}

const EMPTY: UseRunJobsResult = { jobs: [], isLoading: false, error: null };

/// Fetch the workflow jobs for the currently-selected run. No-op for PR rows
/// or when nothing is selected. Re-fetches whenever the selected run id
/// changes; an in-flight fetch is cancelled (its result discarded) so a
/// fast-clicking user doesn't see stale jobs.
export function useRunJobs(item: ActionableItem | null): UseRunJobsResult {
  const id = item?.run ? item.id : null;
  const [result, setResult] = useState<KeyedResult>({
    id: null,
    jobs: [],
    error: null,
  });

  useEffect(() => {
    if (!id) return;
    const parsed = parseRunItemId(id);
    if (!parsed) {
      // .then/.catch setStates are allowed by react-hooks/set-state-in-effect;
      // an inline synchronous setResult would not be. Microtask defer here.
      Promise.resolve().then(() =>
        setResult({ id, jobs: [], error: "bad run id" }),
      );
      return;
    }
    let cancelled = false;
    invoke<WorkflowJobSummary[]>("fetch_run_jobs_command", {
      owner: parsed.owner,
      repo: parsed.repo,
      runId: parsed.runId,
    })
      .then((jobs) => {
        if (cancelled) return;
        setResult({ id, jobs, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setResult({ id, jobs: [], error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!id) return EMPTY;
  if (result.id !== id) {
    // Selection changed but the fetch for it hasn't landed yet — show the
    // loading state without retaining the previous run's jobs.
    return { jobs: [], isLoading: true, error: null };
  }
  return { jobs: result.jobs, isLoading: false, error: result.error };
}
