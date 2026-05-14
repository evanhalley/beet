import { getDb } from "@/lib/storage/db";
import type { EjectedCheck, PrLifecycle } from "@/lib/types";

interface LifecycleRow {
  lifecycle: string;
}

interface EjectionRow {
  observed_at: string;
  head_sha: string;
  failing_checks_json: string;
}

export async function getLatestLifecycle(
  prId: string,
): Promise<PrLifecycle | null> {
  const row = await getLatestLifecycleRow(prId);
  return row ? row.lifecycle : null;
}

export interface LifecycleObservation {
  lifecycle: PrLifecycle;
  observedAt: string;
}

/**
 * The most-recent `pr_lifecycle_history` row for a PR. Because
 * `recordLifecycle` only inserts on a *transition*, the latest row's
 * `observedAt` is the moment the PR entered its current lifecycle state —
 * e.g. for a PR sitting in the merge queue across many polls, this is when
 * it actually entered the queue, not when it was last observed.
 */
export async function getLatestLifecycleRow(
  prId: string,
): Promise<LifecycleObservation | null> {
  const db = await getDb();
  const rows = await db.select<(LifecycleRow & { observed_at: string })[]>(
    "SELECT lifecycle, observed_at FROM pr_lifecycle_history WHERE pr_id = ? ORDER BY observed_at DESC LIMIT 1",
    [prId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    lifecycle: row.lifecycle as PrLifecycle,
    observedAt: row.observed_at,
  };
}

export async function recordLifecycle(
  prId: string,
  lifecycle: PrLifecycle,
): Promise<void> {
  const latest = await getLatestLifecycle(prId);
  if (latest === lifecycle) return;
  const db = await getDb();
  await db.execute(
    "INSERT INTO pr_lifecycle_history (pr_id, lifecycle, observed_at) VALUES (?, ?, ?)",
    [prId, lifecycle, new Date().toISOString()],
  );
}

export async function detectEjection(
  prId: string,
  next: PrLifecycle,
): Promise<boolean> {
  const prev = await getLatestLifecycle(prId);
  return prev === "merge_queue" && next !== "merge_queue" && next !== "merged";
}

export async function recordEjectionEvent(
  prId: string,
  headSha: string,
  failingChecks: EjectedCheck[],
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO pr_ejection_events (pr_id, observed_at, head_sha, failing_checks_json) VALUES (?, ?, ?, ?)",
    [
      prId,
      new Date().toISOString(),
      headSha,
      JSON.stringify(failingChecks),
    ],
  );
}

export interface EjectionEvent {
  observedAt: string;
  headSha: string;
  failingChecks: EjectedCheck[];
}

export async function getLatestEjectionEvent(
  prId: string,
): Promise<EjectionEvent | null> {
  const db = await getDb();
  const rows = await db.select<EjectionRow[]>(
    "SELECT observed_at, head_sha, failing_checks_json FROM pr_ejection_events WHERE pr_id = ? ORDER BY observed_at DESC LIMIT 1",
    [prId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    observedAt: row.observed_at,
    headSha: row.head_sha,
    failingChecks: JSON.parse(row.failing_checks_json) as EjectedCheck[],
  };
}
