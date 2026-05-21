"use client";

import { useEffect, useRef } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useAppStore } from "@/lib/store";
import { checkAndRecord } from "@/lib/storage/notifications";
import type { ActionableItem } from "@/lib/types";

// Snapshot of the previous poll's data so we can compute diffs.
interface PrevSnapshot {
  reviewRequestIds: Set<string>;
  // prId → lastEjectionAt (so we detect when it changes)
  ejectionTimes: Map<string, string>;
  // prId → set of failing check names (so we detect new failures)
  failingCheckPrIds: Set<string>;
  // itemId → updatedAt, for detecting newly-unread items (mention proxy)
  unreadUpdatedAt: Map<string, string>;
  // runId → conclusion (so we detect when a run completes)
  completedRunIds: Set<string>;
}

function emptySnapshot(): PrevSnapshot {
  return {
    reviewRequestIds: new Set(),
    ejectionTimes: new Map(),
    failingCheckPrIds: new Set(),
    unreadUpdatedAt: new Map(),
    completedRunIds: new Set(),
  };
}

function buildSnapshot(
  reviewRequests: ActionableItem[],
  inFlight: ActionableItem[],
  standaloneRuns: ActionableItem[],
): PrevSnapshot {
  const snap = emptySnapshot();
  for (const item of reviewRequests) {
    snap.reviewRequestIds.add(item.id);
  }
  for (const item of inFlight) {
    if (item.pr?.mergeQueue?.lastEjectionAt) {
      snap.ejectionTimes.set(item.id, item.pr.mergeQueue.lastEjectionAt);
    }
    if (
      item.pr?.isAuthoredByMe &&
      item.pr.checkRuns?.some((c) => c.conclusion === "failure")
    ) {
      snap.failingCheckPrIds.add(item.id);
    }
  }
  for (const item of [...reviewRequests, ...inFlight]) {
    if (item.unread) {
      snap.unreadUpdatedAt.set(item.id, item.updatedAt);
    }
  }
  for (const item of standaloneRuns) {
    if (item.run?.status === "completed" && item.run.conclusion) {
      snap.completedRunIds.add(item.id);
    }
  }
  return snap;
}

async function maybeNotify(
  enabled: boolean,
  dedupeKey: string,
  title: string,
  body: string,
): Promise<void> {
  if (!enabled) return;
  const isNew = await checkAndRecord(dedupeKey);
  if (!isNew) return;
  try {
    sendNotification({ title, body });
  } catch {
    // Permission denied or OS error — ignore.
  }
}

export function useNotifications(): void {
  const prevRef = useRef<PrevSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function requestOnce() {
      try {
        const granted = await isPermissionGranted();
        if (!granted) {
          const result = await requestPermission();
          if (result !== "granted") {
            useAppStore
              .getState()
              .setUiError(
                "Notifications denied — enable Beet in System Settings → Notifications.",
              );
          }
        }
      } catch {
        // Not in a Tauri environment (tests) — ignore.
      }
    }

    requestOnce();

    const unsubscribe = useAppStore.subscribe(async (state) => {
      if (cancelled) return;
      const { reviewRequests, inFlight, standaloneRuns, settings } = state;

      const prev = prevRef.current;
      if (!prev) {
        // First tick: build a baseline, no notifications.
        prevRef.current = buildSnapshot(reviewRequests, inFlight, standaloneRuns);
        return;
      }

      const promises: Promise<void>[] = [];

      // ── Trigger 1: Ejected from merge queue ──────────────────────────────
      for (const item of inFlight) {
        const mq = item.pr?.mergeQueue;
        if (!mq?.lastEjectionAt) continue;
        if (item.pr?.lifecycle === "merge_queue") continue; // still queued
        const prevEjectionAt = prev.ejectionTimes.get(item.id);
        if (prevEjectionAt === mq.lastEjectionAt) continue; // already fired
        const key = `eject:${item.id}:${mq.lastEjectionAt}`;
        promises.push(
          maybeNotify(
            settings.notifyOnEjection,
            key,
            `🚨 Kicked from merge queue: ${item.title}`,
            `${item.repoFullName} #${item.pr?.number}`,
          ),
        );
      }

      // ── Trigger 2: Failing checks on your PR ─────────────────────────────
      for (const item of inFlight) {
        if (!item.pr?.isAuthoredByMe) continue;
        const hasFailing = item.pr.checkRuns?.some(
          (c) => c.conclusion === "failure",
        );
        if (!hasFailing) continue;
        if (prev.failingCheckPrIds.has(item.id)) continue; // already known
        const sha = item.pr.mergeQueue?.headSha ?? item.updatedAt;
        const key = `checks-fail:${item.id}:${sha}`;
        const failingNames = (item.pr.checkRuns ?? [])
          .filter((c) => c.conclusion === "failure")
          .slice(0, 2)
          .map((c) => c.name)
          .join(", ");
        promises.push(
          maybeNotify(
            settings.notifyOnFailingChecks,
            key,
            `❌ Checks failing: ${item.title}`,
            `${item.repoFullName} #${item.pr.number}${failingNames ? ` · ${failingNames}` : ""}`,
          ),
        );
      }

      // ── Trigger 3: New review request ────────────────────────────────────
      for (const item of reviewRequests) {
        if (prev.reviewRequestIds.has(item.id)) continue;
        const key = `review-req:${item.id}`;
        promises.push(
          maybeNotify(
            settings.notifyOnReviewRequest,
            key,
            `👀 Review requested: ${item.title}`,
            `${item.repoFullName} #${item.pr?.number} · by @${item.pr?.author ?? ""}`,
          ),
        );
      }

      // ── Trigger 4: Comment / @mention (unread proxy) ─────────────────────
      // Full mention detection requires pr.activity.mentionsMe (§8 follow-up).
      // As a proxy: fire when an existing item becomes newly unread.
      for (const item of [...reviewRequests, ...inFlight]) {
        if (!item.unread) continue;
        const prevUpdatedAt = prev.unreadUpdatedAt.get(item.id);
        if (prevUpdatedAt === item.updatedAt) continue; // same update
        if (!prevUpdatedAt && prev.reviewRequestIds.has(item.id)) {
          // Was already tracked but not unread — now it is
        } else if (!prevUpdatedAt) {
          continue; // brand-new item, handled by trigger 3
        }
        const key = `mention:${item.id}:${item.updatedAt}`;
        promises.push(
          maybeNotify(
            settings.notifyOnMention,
            key,
            `💬 New activity: ${item.title}`,
            `${item.repoFullName} #${item.pr?.number}`,
          ),
        );
      }

      // ── Trigger 5: Workflow run finished ─────────────────────────────────
      for (const item of standaloneRuns) {
        if (item.run?.status !== "completed") continue;
        if (!item.run.conclusion) continue;
        if (prev.completedRunIds.has(item.id)) continue;
        const runId = item.id;
        const conclusion = item.run.conclusion;
        const key = `run:${runId}:${conclusion}`;
        const verb =
          conclusion === "success"
            ? "succeeded"
            : conclusion === "cancelled"
              ? "was cancelled"
              : "failed";
        promises.push(
          maybeNotify(
            settings.notifyOnRunFinished,
            key,
            `${item.run.workflowName} ${verb}`,
            `${item.repoFullName} · ${item.run.branch ?? item.run.sha.slice(0, 7)}`,
          ),
        );
      }

      await Promise.allSettled(promises);

      // Update snapshot for next tick.
      prevRef.current = buildSnapshot(reviewRequests, inFlight, standaloneRuns);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
}
