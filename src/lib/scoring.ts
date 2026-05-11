import dayjs from "dayjs";
import type { ActionableItem } from "@/lib/types";

export function scorePullRequests(
  items: ActionableItem[],
  showAll: boolean = false,
  penalizedBots: string[] = [],
): ActionableItem[] {
  const scored: ActionableItem[] = items.map((item) => {
    if (!item.pr) return item;
    const pr = item.pr;
    let score = 0;

    if (pr.isAuthorOnMyTeam) {
      score += 6;
    }
    if (pr.isReviewRequestedFromMe) {
      score += 3;
    }
    if (pr.iveCommented) {
      score += 2;
    }
    if (pr.iveReviewed) {
      score += 2;
    }
    if (pr.iveApproved) {
      score -= 100;
    }
    if (pr.additions > 250) {
      score -= 1;
    }
    if (pr.deletions > 250) {
      score -= 1;
    }

    if (dayjs().diff(dayjs(item.updatedAt), "days") > 10) {
      score -= 1;
    }
    if (
      dayjs().diff(dayjs(pr.createdAt), "days") > 60 &&
      dayjs().diff(dayjs(item.updatedAt), "days") > 60
    ) {
      score = 0;
    }

    // Stale (line 39-44) and penalized-bot (below) overwrite the running score
    // by design — verbatim from PRZ. Do not change to additive.
    if (penalizedBots.includes(pr.author)) {
      score = -10;
    }
    if (pr.isDraft) {
      score -= 5;
    }

    return { ...item, pr: { ...pr, score } };
  });

  return scored
    .filter((item) => showAll || (item.pr?.score ?? 0) > 0)
    .sort((a, b) => (b.pr?.score ?? 0) - (a.pr?.score ?? 0));
}
