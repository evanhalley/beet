//! Serde structs for the GitHub REST responses Beet consumes. Only the fields
//! the poller actually reads are declared; serde ignores the rest.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct UserRef {
    pub login: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchItem {
    pub number: i64,
    #[serde(default)]
    pub html_url: Option<String>,
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchResult {
    #[serde(default)]
    pub items: Vec<SearchItem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GitRef {
    pub sha: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PullDetail {
    pub title: String,
    #[serde(default)]
    pub body: Option<String>,
    pub html_url: String,
    /// GitHub's GraphQL node ID — needed for the `enqueuePullRequest` mutation
    /// the auto-requeue worker invokes (#13). Optional because some fixtures
    /// and older responses omit it; the worker just skips PRs with no node ID.
    #[serde(default)]
    pub node_id: Option<String>,
    pub state: String,
    #[serde(default)]
    pub merged: bool,
    #[serde(default)]
    pub auto_merge: Option<serde_json::Value>,
    #[serde(default)]
    pub user: Option<UserRef>,
    #[serde(default)]
    pub requested_reviewers: Option<Vec<UserRef>>,
    pub head: GitRef,
    #[serde(default)]
    pub draft: bool,
    pub additions: i64,
    pub deletions: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CommentRow {
    #[serde(default)]
    pub user: Option<UserRef>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReviewRow {
    #[serde(default)]
    pub user: Option<UserRef>,
    pub state: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CheckRun {
    pub name: String,
    /// `"queued" | "in_progress" | "completed"`. Lets the frontend distinguish
    /// a running check (blinking pending dot) from one that's finished.
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub conclusion: Option<String>,
    #[serde(default)]
    pub html_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CheckRunsResult {
    #[serde(default)]
    pub check_runs: Vec<CheckRun>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TeamMember {
    #[serde(default)]
    pub login: Option<String>,
}

/// `GET /user` — the poller needs the authenticated login to build search
/// queries. Token *validation* (scopes, etc.) stays in the JS auth flow.
#[derive(Debug, Clone, Deserialize)]
pub struct AuthUser {
    pub login: String,
}

/// Minimal PR reference inside a workflow run's `pull_requests[]`. Only the
/// `number` is needed to match against the user's tracked PRs (the repo is
/// implied by the run's owning repo).
#[derive(Debug, Clone, Deserialize)]
pub struct RunPullRequestRef {
    pub number: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkflowRunActor {
    #[serde(default)]
    pub login: Option<String>,
}

/// `GET /repos/{owner}/{repo}/actions/runs` row (#6). Only the fields the
/// poller actually reads are declared.
#[derive(Debug, Clone, Deserialize)]
pub struct WorkflowRun {
    pub id: i64,
    /// `name` is the workflow's display name (e.g. "CI"); `null` for some
    /// composite runs.
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub display_title: Option<String>,
    pub status: String,
    #[serde(default)]
    pub conclusion: Option<String>,
    pub event: String,
    pub html_url: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub run_started_at: Option<String>,
    #[serde(default)]
    pub head_branch: Option<String>,
    pub head_sha: String,
    pub run_number: i64,
    #[serde(default)]
    pub actor: Option<WorkflowRunActor>,
    #[serde(default)]
    pub pull_requests: Option<Vec<RunPullRequestRef>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkflowRunsResult {
    #[serde(default)]
    pub workflow_runs: Vec<WorkflowRun>,
}

/// `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs` row. Used by the
/// on-demand jobs fetcher in `runs.rs` to populate the RunDetail Jobs block
/// (#6 follow-up). Only the fields the UI renders are declared.
#[derive(Debug, Clone, Deserialize)]
pub struct WorkflowJob {
    pub id: i64,
    pub name: String,
    /// `"queued" | "in_progress" | "completed"`.
    pub status: String,
    #[serde(default)]
    pub conclusion: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub html_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkflowJobsResult {
    #[serde(default)]
    pub jobs: Vec<WorkflowJob>,
}
