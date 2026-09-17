import type { ActionableItemPr } from "@/lib/types";

export interface BranchCopyTarget {
  /** Text shown next to the copy button. */
  branch: string;
  /**
   * Set for fork PRs: the bare branch name doesn't exist in the base repo
   * (and is often `main`), so the button copies a checkout command instead.
   */
  checkoutCommand?: string;
}

/**
 * What a PR row shows and copies for its head branch: the branch itself for
 * same-repo PRs, `owner:branch` plus `gh pr checkout N` for fork PRs.
 */
export function prBranchTarget(
  pr: Pick<ActionableItemPr, "number" | "headRef" | "headForkOwner">,
): BranchCopyTarget | null {
  if (!pr.headRef) return null;
  if (!pr.headForkOwner) return { branch: pr.headRef };
  return {
    branch: `${pr.headForkOwner}:${pr.headRef}`,
    checkoutCommand: `gh pr checkout ${pr.number}`,
  };
}
