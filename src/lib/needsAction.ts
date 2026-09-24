import { itemHasFailingChecks } from "@/lib/filters";
import type { ActionableItem } from "@/lib/types";

// Needs Action Now (SPECS §5, #25): the urgent slice of the live sections.
// Ejections and failing checks only count on my own PRs — failing CI on a PR
// I'm reviewing stays in Review Requests with its red check dot. Mentions and
// replies to my reviews count on either section.
export type NeedsActionReason = "ejected" | "checks_failing" | "mention" | "reply";

// A merge-queue ejection stays urgent for a day; after that the failing checks
// (if still failing) keep the PR here on their own.
export const EJECTION_WINDOW_MS = 24 * 60 * 60 * 1000;

// Every reason `item` needs action, highest priority first.
export function needsActionReasons(
  item: ActionableItem,
  now: number = Date.now(),
): NeedsActionReason[] {
  const pr = item.pr;
  if (!pr) return [];
  const reasons: NeedsActionReason[] = [];
  if (pr.isAuthoredByMe) {
    const ejectedAt = Date.parse(pr.mergeQueue?.lastEjectionAt ?? "");
    if (Number.isFinite(ejectedAt) && now - ejectedAt < EJECTION_WINDOW_MS) {
      reasons.push("ejected");
    }
    if (itemHasFailingChecks(item)) reasons.push("checks_failing");
  }
  if ((pr.activity?.mentionsMe ?? 0) > 0) reasons.push("mention");
  if ((pr.activity?.replyToMyReview ?? 0) > 0) reasons.push("reply");
  return reasons;
}

// The reason shown on the row badge, or null when the item doesn't qualify.
export function primaryReason(
  item: ActionableItem,
  now: number = Date.now(),
): NeedsActionReason | null {
  return needsActionReasons(item, now)[0] ?? null;
}

// Build the Needs Action list from the already-visible In Flight and Review
// Requests lists (mutes, snoozes, list filters, and the review-request
// visibility predicate applied upstream). Items also stay in their home
// section. Deduped by id, most recently updated first.
export function selectNeedsAction(
  inFlight: ActionableItem[],
  visibleReviewRequests: ActionableItem[],
  now: number = Date.now(),
): ActionableItem[] {
  const seen = new Set<string>();
  const out: ActionableItem[] = [];
  for (const item of [...inFlight, ...visibleReviewRequests]) {
    if (seen.has(item.id) || primaryReason(item, now) === null) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// Tray badge count (SPECS §10): unread items in Needs Action Now plus unread
// visible review requests, counting a PR that sits in both only once. Shared
// by the menu-bar badge and the tray popover header so they can't drift.
export function countBadgeItems(
  needsAction: ActionableItem[],
  visibleReviewRequests: ActionableItem[],
): number {
  const ids = new Set<string>();
  for (const item of [...needsAction, ...visibleReviewRequests]) {
    if (item.unread) ids.add(item.id);
  }
  return ids.size;
}
