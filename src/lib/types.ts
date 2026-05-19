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

// One row in the DetailPane's Reviewers block. Latest state per login when a
// reviewer has submitted multiple reviews; pending requests appear as
// `state: "requested"` so the block doesn't drop them.
export interface ReviewerEntry {
  login: string;
  // "approved" | "changes_requested" | "commented" | "requested" |
  // "dismissed" — string-typed so unknown future states render as a neutral
  // pill instead of breaking the contract.
  state: string;
}

// One row in the DetailPane's Checks block. Status distinguishes a running
// check from a finished one; conclusion is the final verdict.
export interface CheckRunSummary {
  name: string;
  status?: string;     // "queued" | "in_progress" | "completed"
  conclusion?: string; // "success" | "failure" | "neutral" | ...
  detailsUrl?: string;
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

// One workflow run rolled up into a PR's `associatedRuns` (#6). Only the
// most-recent run per workflow name is kept; the DetailPane Checks block
// renders these next to the per-commit `checkRuns`.
export interface AssociatedRun {
  workflowName: string;
  status: string;          // "queued" | "in_progress" | "completed"
  conclusion?: string;     // "success" | "failure" | ... ; absent while running
  runUrl: string;
  completedAt: string | null;
}

// One job inside a workflow run. Fetched on-demand by the RunDetail view via
// the `fetch_run_jobs_command` Tauri command (#6 follow-up).
export interface WorkflowJobSummary {
  id: number;
  name: string;
  status: string;          // "queued" | "in_progress" | "completed"
  conclusion?: string;
  startedAt?: string;
  completedAt?: string;
  htmlUrl?: string;
}

// Workflow-run payload for the Standalone Runs section and the run half of
// Recently Resolved. Carried on `ActionableItem.run`.
export interface ActionableItemRun {
  workflowName: string;
  event: string;           // "push" | "pull_request" | "workflow_dispatch" | ...
  status: string;
  conclusion?: string;
  branch: string | null;
  sha: string;
  runNumber: number;
  actorLogin: string;
  runUrl: string;
  startedAt: string | null;
  completedAt: string | null;
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
  reviewers?: ReviewerEntry[];
  checkRuns?: CheckRunSummary[];
  associatedRuns?: AssociatedRun[];
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
  // Set for `kind = "standalone_run"` items (Standalone Runs section and
  // the run half of Recently Resolved). Absent for PR rows.
  run?: ActionableItemRun;
}
