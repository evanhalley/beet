export type ActionableKind = "pr" | "standalone_run";

export type PrLifecycle =
  | "open"
  | "in_review"
  | "merge_queue"
  | "merged"
  | "closed";

export interface EjectedCheck {
  name: string;
  conclusion: string;
  detailsUrl?: string | null;
}

export interface ActionableItemMergeQueue {
  position: number | null;
  enteredAt: string;
  lastEjectionAt?: string;
  ejectedChecks?: EjectedCheck[];
  // Head SHA at the time the row was assembled. Used by the DetailPane to
  // look up per-(prId, headSha) auto-requeue history (#13).
  headSha?: string;
  // PR's GraphQL node ID, carried through from the Rust auto-requeue worker.
  prNodeId?: string;
}

export interface ActionableItemPr {
  number: number;
  author: string;
  body: string | null;
  isAuthoredByMe: boolean;
  isReviewRequestedFromMe: boolean;
  isAuthorOnMyTeam: boolean;
  iveCommented: boolean;
  iveReviewed: boolean;
  iveApproved: boolean;
  approvalCount: number;
  isDraft: boolean;
  additions: number;
  deletions: number;
  createdAt: string;
  lifecycle: PrLifecycle;
  mergeQueue?: ActionableItemMergeQueue;
  taskUrls: string[];
  score: number;
}

export interface ActionableItem {
  id: string;
  kind: ActionableKind;
  title: string;
  url: string;
  repoFullName: string;
  updatedAt: string;
  unread: boolean;
  dismissedUntilFingerprint: string | null;
  pr?: ActionableItemPr;
}
