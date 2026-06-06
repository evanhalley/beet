"use client";

import { useEffect, useRef } from "react";
import {
  isPermissionGranted,
  onNotificationClicked,
  requestPermission,
  sendNotification,
} from "@choochmeque/tauri-plugin-notifications-api";
import { invoke } from "@tauri-apps/api/core";
import { applyMutes, useAppStore } from "@/lib/store";
import type { MuteRule } from "@/lib/store";
import {
  checkAndRecord,
  getNotificationLink,
  notifIdFromKey,
  recordNotificationLink,
} from "@/lib/storage/notifications";
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
  // ActionableItem id selected when the user clicks the notification. Routed
  // through a persisted id→item map (notifIdFromKey) because the macOS plugin
  // drops the `extra` payload on click and only round-trips the numeric `id`.
  itemId: string,
): Promise<void> {
  if (!enabled) return;
  const isNew = await checkAndRecord(dedupeKey);
  if (!isNew) return;
  const id = notifIdFromKey(dedupeKey);
  await recordNotificationLink(id, itemId);
  try {
    sendNotification({ title, body, id });
  } catch {
    // Permission denied or OS error — ignore.
  }
}

// Tracks the last set of poll-relevant slice references seen by the subscriber.
// Used to skip store updates that aren't poll-driven (selected item, UI errors,
// settings toggles, etc.) without paying the cost of the full diff loop.
interface SeenSlices {
  lastPolledAt: string | null;
  reviewRequests: unknown;
  inFlight: unknown;
  standaloneRuns: unknown;
  mutes: unknown;
  settings: unknown;
}

export function useNotifications(): void {
  const prevRef = useRef<PrevSnapshot | null>(null);
  const seenRef = useRef<SeenSlices>({
    lastPolledAt: null,
    reviewRequests: null,
    inFlight: null,
    standaloneRuns: null,
    mutes: null,
    settings: null,
  });

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

    // Bring Beet forward and select the associated item when a notification is
    // clicked. The plugin round-trips only the numeric `id`, so resolve it to an
    // ActionableItem id via the persisted link map. Also covers cold-start: if
    // the app was launched by a notification tap, the click is delivered when
    // the listener registers (item is selected once the first poll loads it).
    let clickListener: { unregister: () => void } | undefined;
    onNotificationClicked(async (data) => {
      const itemId = await getNotificationLink(data.id);
      if (!itemId) return;
      try {
        await invoke("open_main_window");
      } catch {
        // Not in Tauri — ignore.
      }
      useAppStore.getState().setPendingNotificationItemId(itemId);
    })
      .then((listener) => {
        if (cancelled) {
          listener.unregister();
          return;
        }
        clickListener = listener;
      })
      .catch(() => {
        // Not in a Tauri environment (tests) — ignore.
      });

    const unsubscribe = useAppStore.subscribe(async (state) => {
      if (cancelled) return;

      // Don't process until at least one poll has completed — otherwise a
      // settings-hydration or mutes-load event will set an empty baseline and
      // the first real poll tick will fire notifications for every existing item.
      if (!state.lastPolledAt) return;

      const { reviewRequests, inFlight, standaloneRuns, settings, mutes, lastPolledAt } = state;

      // Skip if none of the poll-relevant slices changed reference. UI-only
      // state changes (selectedItemId, uiError, etc.) should not retrigger
      // the diff loop or waste SQLite dedupe round-trips.
      const seen = seenRef.current;
      if (
        seen.lastPolledAt === lastPolledAt &&
        seen.reviewRequests === reviewRequests &&
        seen.inFlight === inFlight &&
        seen.standaloneRuns === standaloneRuns &&
        seen.mutes === mutes &&
        seen.settings === settings
      ) return;
      seenRef.current = { lastPolledAt, reviewRequests, inFlight, standaloneRuns, mutes, settings };

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
            item.id,
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
            item.id,
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
            item.id,
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
            item.id,
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
            item.id,
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
      clickListener?.unregister();
      unsubscribe();
    };
  }, []);
}
