"use client";

import { useEffect, useRef } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { applyMutes, useAppStore } from "@/lib/store";
import type { MuteRule } from "@/lib/store";
import { checkAndRecord } from "@/lib/storage/notifications";
import type { ActionableItem } from "@/lib/types";

// Snapshot of the previous poll's data so we can compute diffs.
interface PrevSnapshot {
  reviewRequestIds: Set<string>;
  // All item IDs seen in reviews + in-flight. Distinguishes "was tracked but
  // newly unread" from "brand-new item" in trigger 4, covering both sections.
  allTrackedIds: Set<string>;
  // prId → lastEjectionAt (so we detect when it changes)
  ejectionTimes: Map<string, string>;
  // prId → stableId of the last failing-checks notification. Keyed on the
  // stableId (headSha or sorted check names) so we re-fire if the set changes.
  failingCheckStableIds: Map<string, string>;
  // itemId → updatedAt, for detecting newly-unread items (mention proxy)
  unreadUpdatedAt: Map<string, string>;
  // runId → conclusion (so we detect when a run completes)
  completedRunIds: Set<string>;
  // Fingerprint of mutes at snapshot build time. When mutes change we
  // silently rebuild the baseline rather than diffing against a stale filter.
  mutesKey: string;
}

function emptySnapshot(): PrevSnapshot {
  return {
    reviewRequestIds: new Set(),
    allTrackedIds: new Set(),
    ejectionTimes: new Map(),
    failingCheckStableIds: new Map(),
    unreadUpdatedAt: new Map(),
    completedRunIds: new Set(),
    mutesKey: "",
  };
}

function mutesFingerprint(mutes: MuteRule[]): string {
  return mutes
    .map((m) => `${m.scope}:${m.value}`)
    .sort()
    .join("|");
}

function buildSnapshot(
  reviewRequests: ActionableItem[],
  inFlight: ActionableItem[],
  standaloneRuns: ActionableItem[],
  mutesKey: string,
): PrevSnapshot {
  const snap = emptySnapshot();
  snap.mutesKey = mutesKey;

  for (const item of reviewRequests) {
    snap.reviewRequestIds.add(item.id);
    snap.allTrackedIds.add(item.id);
  }
  for (const item of inFlight) {
    snap.allTrackedIds.add(item.id);
    if (item.pr?.mergeQueue?.lastEjectionAt) {
      snap.ejectionTimes.set(item.id, item.pr.mergeQueue.lastEjectionAt);
    }
    if (item.pr?.isAuthoredByMe) {
      const failingRuns = (item.pr.checkRuns ?? []).filter(
        (c) => c.conclusion === "failure",
      );
      if (failingRuns.length > 0) {
        const stableId =
          item.pr.mergeQueue?.headSha ??
          failingRuns.map((c) => c.name).sort().join(",");
        snap.failingCheckStableIds.set(item.id, stableId);
      }
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

      // Don't process until at least one poll has completed — otherwise a
      // settings-hydration or mutes-load event will set an empty baseline and
      // the first real poll tick will fire notifications for every existing item.
      if (!state.lastPolledAt) return;

      const { reviewRequests, inFlight, standaloneRuns, settings, mutes } = state;
      const currentMutesKey = mutesFingerprint(mutes);

      // Apply mute rules so notifications are never fired for muted repos/orgs.
      const filteredReviews = applyMutes(reviewRequests, mutes);
      const filteredInFlight = applyMutes(inFlight, mutes);
      const filteredRuns = applyMutes(standaloneRuns, mutes);

      const prev = prevRef.current;
      if (!prev || prev.mutesKey !== currentMutesKey) {
        // First completed poll, or mutes changed: rebuild baseline without
        // firing notifications. This prevents false positives when mutes load
        // after the first poll, and keeps the snapshot consistent when rules
        // are added/removed at runtime.
        prevRef.current = buildSnapshot(
          filteredReviews,
          filteredInFlight,
          filteredRuns,
          currentMutesKey,
        );
        return;
      }

      const promises: Promise<void>[] = [];

      // ── Trigger 1: Ejected from merge queue ──────────────────────────────
      for (const item of filteredInFlight) {
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
      for (const item of filteredInFlight) {
        if (!item.pr?.isAuthoredByMe) continue;
        const failingRuns = (item.pr.checkRuns ?? []).filter(
          (c) => c.conclusion === "failure",
        );
        if (failingRuns.length === 0) continue;
        // Use mergeQueue.headSha when available; otherwise key off the sorted
        // set of failing check names (stable per-commit, unlike updatedAt).
        const stableId =
          item.pr.mergeQueue?.headSha ??
          failingRuns.map((c) => c.name).sort().join(",");
        // Re-fire if the stableId changed — a different set of checks is now
        // failing. Checking the Map (not a Set of prIds) ensures we catch
        // regressions on previously-green checks.
        if (prev.failingCheckStableIds.get(item.id) === stableId) continue;
        const key = `checks-fail:${item.id}:${stableId}`;
        const failingNames = failingRuns.slice(0, 2).map((c) => c.name).join(", ");
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
      for (const item of filteredReviews) {
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
      // As a proxy: fire when a previously-tracked item (review request OR
      // in-flight) becomes newly unread. Using allTrackedIds covers both
      // sections — checking reviewRequestIds alone would miss in-flight PRs.
      for (const item of [...filteredReviews, ...filteredInFlight]) {
        if (!item.unread) continue;
        const prevUpdatedAt = prev.unreadUpdatedAt.get(item.id);
        if (prevUpdatedAt === item.updatedAt) continue; // no new activity
        // Skip brand-new items — they haven't been in any previous snapshot.
        // Review requests are handled by trigger 3; in-flight newcomers have
        // no prior context to generate a meaningful "new activity" alert.
        if (!prevUpdatedAt && !prev.allTrackedIds.has(item.id)) continue;
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
      for (const item of filteredRuns) {
        if (item.run?.status !== "completed") continue;
        if (!item.run.conclusion) continue;
        if (prev.completedRunIds.has(item.id)) continue;
        const conclusion = item.run.conclusion;
        const key = `run:${item.id}:${conclusion}`;
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

      // Guard against unmount that occurred while awaiting — unsubscribe() was
      // already called but this in-flight callback continued past the entry
      // check. Don't mutate the ref or send further work.
      if (cancelled) return;

      // Update snapshot for next tick.
      prevRef.current = buildSnapshot(
        filteredReviews,
        filteredInFlight,
        filteredRuns,
        currentMutesKey,
      );
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
}
