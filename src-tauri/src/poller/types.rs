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
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn keys(value: &Value) -> Vec<String> {
        let mut k: Vec<String> = value
            .as_object()
            .unwrap()
            .keys()
            .map(|s| s.to_string())
            .collect();
        k.sort();
        k
    }

    fn full_item() -> ActionableItem {
        ActionableItem {
            id: "pr:foo/bar#1".into(),
            kind: ActionableKind::Pr,
            title: "T".into(),
            url: "u".into(),
            repo_full_name: "foo/bar".into(),
            updated_at: "2026-01-01T00:00:00.000Z".into(),
            unread: true,
            dismissed_until_fingerprint: None,
            pr: Some(ActionableItemPr {
                number: 1,
                author: "a".into(),
                body: None,
                is_authored_by_me: false,
                is_review_requested_from_me: true,
                is_author_on_my_team: false,
                ive_commented: false,
                ive_reviewed: false,
                ive_approved: false,
                approval_count: 0,
                is_draft: false,
                additions: 1,
                deletions: 2,
                created_at: "2026-01-01T00:00:00.000Z".into(),
                lifecycle: PrLifecycle::MergeQueue,
                merge_queue: Some(ActionableItemMergeQueue {
                    position: None,
                    entered_at: "2026-01-01T00:00:00.000Z".into(),
                    last_ejection_at: Some("2026-01-02T00:00:00.000Z".into()),
                    ejected_checks: Some(vec![EjectedCheck {
                        name: "ci".into(),
                        conclusion: "failure".into(),
                        details_url: None,
                    }]),
                    head_sha: Some("deadbeef".into()),
                    pr_node_id: Some("PR_kwDOA".into()),
                }),
                task_urls: vec![],
                score: 3,
                reviewers: Some(vec![ReviewerEntry {
                    login: "rina".into(),
                    state: "approved".into(),
                }]),
                check_runs: Some(vec![CheckRunSummary {
                    name: "build".into(),
                    status: Some("completed".into()),
                    conclusion: Some("success".into()),
                    details_url: None,
                }]),
            }),
        }
    }

    /// The JSON keys + enum spellings must match the frozen `src/lib/types.ts`
    /// contract exactly, since the frontend deserializes these unchanged.
    #[test]
    fn actionable_item_matches_the_ts_contract() {
        let json = serde_json::to_value(full_item()).unwrap();
        assert_eq!(
            keys(&json),
            vec![
                "dismissedUntilFingerprint",
                "id",
                "kind",
                "pr",
                "repoFullName",
                "title",
                "unread",
                "updatedAt",
                "url",
            ]
        );
        assert_eq!(json["kind"], "pr");

        let pr = &json["pr"];
        assert_eq!(
            keys(pr),
            vec![
                "additions",
                "approvalCount",
                "author",
                "body",
                "checkRuns",
                "createdAt",
                "deletions",
                "isAuthorOnMyTeam",
                "isAuthoredByMe",
                "isDraft",
                "isReviewRequestedFromMe",
                "iveApproved",
                "iveCommented",
                "iveReviewed",
                "lifecycle",
                "mergeQueue",
                "number",
                "reviewers",
                "score",
                "taskUrls",
            ]
        );
        assert_eq!(pr["lifecycle"], "merge_queue");
        assert_eq!(keys(&pr["reviewers"][0]), vec!["login", "state"]);
        assert_eq!(keys(&pr["checkRuns"][0]), vec!["conclusion", "name", "status"]);

        let mq = &pr["mergeQueue"];
        assert_eq!(
            keys(mq),
            vec![
                "ejectedChecks",
                "enteredAt",
                "headSha",
                "lastEjectionAt",
                "position",
                "prNodeId",
            ]
        );
        assert_eq!(keys(&mq["ejectedChecks"][0]), vec!["conclusion", "detailsUrl", "name"]);
    }

    /// Optional fields collapse out of the JSON when absent, matching the
    /// TypeScript `?` optionality.
    #[test]
    fn optional_fields_are_omitted_when_none() {
        let mut item = full_item();
        item.pr = None;
        let json = serde_json::to_value(&item).unwrap();
        assert!(json.as_object().unwrap().get("pr").is_none());

        let mut item = full_item();
        if let Some(pr) = item.pr.as_mut() {
            pr.merge_queue = None;
        }
        let json = serde_json::to_value(&item).unwrap();
        assert!(json["pr"].as_object().unwrap().get("mergeQueue").is_none());
    }

    /// Round-trips through JSON without loss.
    #[test]
    fn actionable_item_round_trips() {
        let item = full_item();
        let json = serde_json::to_string(&item).unwrap();
        let back: ActionableItem = serde_json::from_str(&json).unwrap();
        assert_eq!(item, back);
    }
}
