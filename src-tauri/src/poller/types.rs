//! Rust mirror of `src/lib/types.ts`. The TS file is the frozen contract; these
//! structs must serialize to byte-identical JSON (camelCase, same optionality).
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionableKind {
    Pr,
    StandaloneRun,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrLifecycle {
    Open,
    InReview,
    MergeQueue,
    Merged,
    Closed,
}

impl PrLifecycle {
    /// The string form persisted in `pr_lifecycle_history` — must match the
    /// snake_case serde representation so JS-written rows interoperate.
    pub fn as_db_str(self) -> &'static str {
        match self {
            PrLifecycle::Open => "open",
            PrLifecycle::InReview => "in_review",
            PrLifecycle::MergeQueue => "merge_queue",
            PrLifecycle::Merged => "merged",
            PrLifecycle::Closed => "closed",
        }
    }

    pub fn from_db_str(s: &str) -> Option<PrLifecycle> {
        match s {
            "open" => Some(PrLifecycle::Open),
            "in_review" => Some(PrLifecycle::InReview),
            "merge_queue" => Some(PrLifecycle::MergeQueue),
            "merged" => Some(PrLifecycle::Merged),
            "closed" => Some(PrLifecycle::Closed),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EjectedCheck {
    pub name: String,
    pub conclusion: String,
    pub details_url: Option<String>,
}

/// One row in the DetailPane's Reviewers block. `state` is a string rather
/// than an enum so the contract can extend cleanly (e.g. future `dismissed`)
/// without churning frontend code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewerEntry {
    pub login: String,
    /// `"approved" | "changes_requested" | "commented" | "requested" | "dismissed"`.
    pub state: String,
}

/// One row in the DetailPane's Checks block. Carries enough for the design's
/// CheckDot derivation (status vs conclusion) plus a click-through URL we'll
/// wire up later.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckRunSummary {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conclusion: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionableItemMergeQueue {
    pub position: Option<i64>,
    pub entered_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_ejection_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ejected_checks: Option<Vec<EjectedCheck>>,
    /// Head SHA at the time the row was assembled. Sent to the frontend so the
    /// DetailPane can look up the per-`(prId, headSha)` requeue history (#13).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_sha: Option<String>,
    /// PR's GraphQL node ID. Consumed by the auto-requeue worker to call the
    /// `enqueuePullRequest` mutation; carried through to the frontend so it
    /// stays close to the row it belongs to (#13).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pr_node_id: Option<String>,
}

/// One workflow run attached to a PR's `associated_runs`. The DetailPane's
/// Checks block renders these alongside `check_runs` so a PR's CI surface
/// includes both the per-commit check-suites and the user-triggered runs
/// (which can include things check-runs don't, like deploys).
///
/// Only the most-recent run per workflow name is kept (#6 / SPECS §5).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssociatedRun {
    pub workflow_name: String,
    /// `"queued" | "in_progress" | "completed"`.
    pub status: String,
    /// Final verdict; `None` while still running.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conclusion: Option<String>,
    pub run_url: String,
    pub completed_at: Option<String>,
}

/// Standalone-run payload — the run-side analogue of `ActionableItemPr`.
/// Carried on `ActionableItem.run` for both Standalone Runs and the run
/// half of Recently Resolved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionableItemRun {
    pub workflow_name: String,
    /// `push`, `pull_request`, `workflow_dispatch`, `schedule`, etc.
    pub event: String,
    /// `"queued" | "in_progress" | "completed"`.
    pub status: String,
    /// Final verdict; `None` while still running.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conclusion: Option<String>,
    pub branch: Option<String>,
    pub sha: String,
    pub run_number: i64,
    pub actor_login: String,
    pub run_url: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionableItemPr {
    pub number: i64,
    pub author: String,
    pub body: Option<String>,
    pub is_authored_by_me: bool,
    pub is_review_requested_from_me: bool,
    pub is_author_on_my_team: bool,
    pub ive_commented: bool,
    pub ive_reviewed: bool,
    pub ive_approved: bool,
    pub approval_count: i64,
    pub is_draft: bool,
    pub additions: i64,
    pub deletions: i64,
    pub created_at: String,
    pub lifecycle: PrLifecycle,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merge_queue: Option<ActionableItemMergeQueue>,
    pub task_urls: Vec<String>,
    pub score: i64,
    /// Full reviewer roll-up for the DetailPane. Absent if the PR's reviews
    /// haven't been hydrated yet (transient mid-cycle state); the frontend
    /// then renders the empty-state line.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reviewers: Option<Vec<ReviewerEntry>>,
    /// All check-runs for the PR's head SHA. Absent when the check-runs
    /// fetch failed for non-critical reasons — the row still renders.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub check_runs: Option<Vec<CheckRunSummary>>,
    /// Workflow runs for this PR, one per workflow name (most recent kept),
    /// attached by the run-collapse pass (#6 / SPECS §7). Absent when no
    /// runs matched — the PR row still renders.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub associated_runs: Option<Vec<AssociatedRun>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionableItem {
    pub id: String,
    pub kind: ActionableKind,
    pub title: String,
    pub url: String,
    pub repo_full_name: String,
    pub updated_at: String,
    pub unread: bool,
    pub dismissed_until_fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pr: Option<ActionableItemPr>,
    /// Set for `kind = "standalone_run"` items (Standalone Runs section and
    /// the run half of Recently Resolved). `None` for PR rows.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run: Option<ActionableItemRun>,
}

#[cfg(test)]
#[path = "__tests__/types.rs"]
mod tests;
