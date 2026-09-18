import type { ActionableItemPr } from "@/lib/types";

/// True when polling resolved CODEOWNERS for this PR and the user owns at
/// least one changed file. Drives the "owner" pill on review rows and the
/// detail header; absent ownership (never resolved) counts as not an owner.
export function isCodeOwner(pr: ActionableItemPr | undefined): boolean {
  return (pr?.codeOwnership?.ownedCount ?? 0) > 0;
}
