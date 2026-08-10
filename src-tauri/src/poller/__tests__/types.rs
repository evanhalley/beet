
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
            associated_runs: None,
        }),
        run: None,
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
    assert_eq!(
        keys(&pr["checkRuns"][0]),
        vec!["conclusion", "name", "status"]
    );

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
    assert_eq!(
        keys(&mq["ejectedChecks"][0]),
        vec!["conclusion", "detailsUrl", "name"]
    );
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

fn full_run_item() -> ActionableItem {
    ActionableItem {
        id: "run:foo/bar#42".into(),
        kind: ActionableKind::StandaloneRun,
        title: "deploy.yml".into(),
        url: "https://github.com/foo/bar/actions/runs/42".into(),
        repo_full_name: "foo/bar".into(),
        updated_at: "2026-01-01T00:00:00.000Z".into(),
        unread: true,
        dismissed_until_fingerprint: None,
        pr: None,
        run: Some(ActionableItemRun {
            workflow_name: "Deploy".into(),
            event: "workflow_dispatch".into(),
            status: "completed".into(),
            conclusion: Some("success".into()),
            branch: Some("main".into()),
            sha: "deadbeef".into(),
            run_number: 7,
            actor_login: "evan".into(),
            run_url: "https://github.com/foo/bar/actions/runs/42".into(),
            started_at: Some("2026-01-01T00:00:00.000Z".into()),
            completed_at: Some("2026-01-01T00:01:00.000Z".into()),
        }),
    }
}

#[test]
fn run_item_serializes_with_camel_case_run_payload() {
    let json = serde_json::to_value(full_run_item()).unwrap();
    assert_eq!(json["kind"], "standalone_run");
    assert!(json.as_object().unwrap().get("pr").is_none());

    let run = &json["run"];
    assert_eq!(
        keys(run),
        vec![
            "actorLogin",
            "branch",
            "completedAt",
            "conclusion",
            "event",
            "runNumber",
            "runUrl",
            "sha",
            "startedAt",
            "status",
            "workflowName",
        ]
    );
    assert_eq!(run["workflowName"], "Deploy");
}

#[test]
fn associated_runs_serializes_as_camel_case() {
    let mut item = full_item();
    if let Some(pr) = item.pr.as_mut() {
        pr.associated_runs = Some(vec![AssociatedRun {
            workflow_name: "CI".into(),
            status: "completed".into(),
            conclusion: Some("success".into()),
            run_url: "https://github.com/foo/bar/actions/runs/9".into(),
            completed_at: Some("2026-01-01T00:00:00.000Z".into()),
        }]);
    }
    let json = serde_json::to_value(&item).unwrap();
    let ar = &json["pr"]["associatedRuns"][0];
    assert_eq!(
        keys(ar),
        vec![
            "completedAt",
            "conclusion",
            "runUrl",
            "status",
            "workflowName",
        ]
    );
}

#[test]
fn run_item_round_trips() {
    let item = full_run_item();
    let json = serde_json::to_string(&item).unwrap();
    let back: ActionableItem = serde_json::from_str(&json).unwrap();
    assert_eq!(item, back);
}
