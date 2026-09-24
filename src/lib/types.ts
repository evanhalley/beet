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
  // Head SHA at the time the row was assembled. Used by `useNotifications`
  // to key the failing-checks dedupe.
  headSha?: string;
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

// Compact CODEOWNERS summary carried on review-request items so the list rows
// can show the "owner" badge without a per-row fetch.
export interface CodeOwnership {
  ownedCount: number;
  totalCount: number;
  hasCodeowners: boolean;
  // False when the token lacks read:org, so only @user rules were matched.
  teamsResolved: boolean;
}

// One changed file in a PR, from the `fetch_pr_files_command` Tauri command.
export interface PrChangedFile {
  path: string;
  previousPath?: string;
  status: string; // "added" | "modified" | "removed" | "renamed" | "copied" | ...
  additions: number;
  deletions: number;
  // Owner tokens from the winning CODEOWNERS rule, as written (@user, @org/team).
  owners: string[];
  ownedByMe: boolean;
  // `diff-<sha256(path)>` — the URL fragment github.com uses on the Files tab.
  anchor: string;
}

// Full Files-block payload for one PR.
export interface PrFilesResult {
  files: PrChangedFile[];
  hasCodeowners: boolean;
  codeownersPath?: string;
  teamsResolved: boolean;
  ownedCount: number;
  totalCount: number;
  truncated: boolean;
  // Authenticated login, for GitHub's owned-by deep link.
  username: string;
}

// Unread inbox events directed at me on a PR (#25), routed from GitHub's
// notifications inbox. Counts clear once the thread is read on GitHub.
export interface PrActivity {
  mentionsMe: number;
  replyToMyReview: number;
}

// One comment in the DetailPane's Activity block, from the
// `fetch_pr_comments_command` Tauri command. `kind: "review"` is an inline
// diff comment; replies point at their thread root via `inReplyToId`.
export interface PrComment {
  id: number;
  kind: "issue" | "review";
  author: string;
  body: string;
  createdAt: string;
  htmlUrl: string;
  inReplyToId?: number;
  path?: string;
}

export interface PrCommentsResult {
  comments: PrComment[];
  // Authenticated login, for highlighting `@me`.
  username: string;
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
  /** Head branch name (`pull.head.ref`). Absent when unknown. */
  headRef?: string;
  /** Owner of the fork the head branch lives in; absent for same-repo PRs. */
  headForkOwner?: string;
  /** Head / base commit + base branch, for the detail pane's Files block. */
  headSha?: string;
  baseRef?: string;
  baseSha?: string;
  /** CODEOWNERS stake, resolved during polling for review requests only. */
  codeOwnership?: CodeOwnership;
  lifecycle: PrLifecycle;
  mergeQueue?: ActionableItemMergeQueue;
  taskUrls: string[];
  score: number;
  reviewers?: ReviewerEntry[];
  checkRuns?: CheckRunSummary[];
  associatedRuns?: AssociatedRun[];
  activity?: PrActivity;
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
