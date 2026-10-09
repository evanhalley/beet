use super::*;
use crate::poller::types::{
    ActionableItemPr, ActionableKind, AiAssist, AiSource, AssociatedRun, CheckRunSummary,
    PrLifecycle,
};
use chrono::Duration;

fn make_item(id: &str, now: DateTime<Utc>) -> ActionableItem {
    let now_iso = now.to_rfc3339();
    ActionableItem {
        id: id.to_string(),
        kind: ActionableKind::Pr,
        title: "Test PR".to_string(),
        url: "https://github.com/foo/bar/pull/123".to_string(),
        repo_full_name: "foo/bar".to_string(),
        updated_at: now_iso.clone(),
        unread: true,
        dismissed_until_fingerprint: None,
        pr: Some(ActionableItemPr {
            number: 123,
            author: "johndoe".to_string(),
            body: None,
            is_authored_by_me: false,
            is_review_requested_from_me: false,
            is_author_on_my_team: false,
            ive_commented: false,
            ive_reviewed: false,
            ive_approved: false,
            approval_count: 0,
            is_draft: false,
            additions: 10,
            deletions: 10,
            created_at: now_iso,
            head_ref: None,
            head_fork_owner: None,
            head_sha: None,
            base_ref: None,
            base_sha: None,
            code_ownership: None,
            ai_assist: None,
            lifecycle: PrLifecycle::Open,
            merge_queue: None,
            task_urls: vec![],
            score: 0,
            reviewers: None,
            check_runs: None,
            associated_runs: None,
            activity: None,
        }),
        run: None,
    }
}

#[test]
fn scores_team_member_pr_highly() {
    let now = Utc::now();
    let mut item = make_item("pr:foo/bar#1", now);
    item.pr.as_mut().unwrap().is_author_on_my_team = true;
    let result = score_pull_requests_at(vec![item], false, &[], now);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].pr.as_ref().unwrap().score, 6);
}

#[test]
fn adds_points_for_request_comment_review() {
    let now = Utc::now();
    let mut item = make_item("pr:foo/bar#1", now);
    {
        let pr = item.pr.as_mut().unwrap();
        pr.is_review_requested_from_me = true;
        pr.ive_commented = true;
        pr.ive_reviewed = true;
    }
    let result = score_pull_requests_at(vec![item], false, &[], now);
    assert_eq!(result[0].pr.as_ref().unwrap().score, 7);
}

#[test]
fn filters_out_zero_or_negative_scores() {
    let now = Utc::now();
    let item = make_item("pr:foo/bar#1", now);
    let result = score_pull_requests_at(vec![item], false, &[], now);
    assert_eq!(result.len(), 0);
}

#[test]
fn subtracts_for_large_prs_and_drafts() {
    let now = Utc::now();
    let mut item = make_item("pr:foo/bar#1", now);
    {
        let pr = item.pr.as_mut().unwrap();
        pr.is_author_on_my_team = true; // +6
        pr.additions = 300; // -1
        pr.deletions = 300; // -1
        pr.is_draft = true; // -5
    }
    // 6 - 1 - 1 - 5 = -1 -> filtered out
    let result = score_pull_requests_at(vec![item], false, &[], now);
    assert_eq!(result.len(), 0);
}

#[test]
fn penalized_bot_overwrites_to_minus_ten() {
    let now = Utc::now();
    let mut item = make_item("pr:foo/bar#1", now);
    {
        let pr = item.pr.as_mut().unwrap();
        pr.author = "renovate[bot]".to_string();
        pr.is_review_requested_from_me = true;
        pr.is_author_on_my_team = true;
    }
    let result = score_pull_requests_at(vec![item], false, &["renovate[bot]".to_string()], now);
    assert_eq!(result.len(), 0);
}

#[test]
fn show_all_surfaces_approved_prs_at_bottom() {
    let now = Utc::now();
    let mut approved = make_item("pr:foo/bar#123", now);
    {
        let pr = approved.pr.as_mut().unwrap();
        pr.ive_approved = true;
        pr.is_author_on_my_team = true;
    }
    let mut fresh = make_item("pr:foo/bar#456", now);
    fresh.pr.as_mut().unwrap().is_author_on_my_team = true;
    let result = score_pull_requests_at(vec![approved, fresh], true, &[], now);
    assert_eq!(result.len(), 2);
    assert_eq!(result[0].id, "pr:foo/bar#456");
    assert_eq!(result[1].id, "pr:foo/bar#123");
    assert!(result[1].pr.as_ref().unwrap().score < 0);
}

#[test]
fn stale_rule_overwrites_to_zero() {
    let now = Utc::now();
    let old = (now - Duration::days(90)).to_rfc3339();
    let mut item = make_item("pr:foo/bar#1", now);
    item.updated_at = old.clone();
    {
        let pr = item.pr.as_mut().unwrap();
        pr.is_author_on_my_team = true;
        pr.created_at = old;
    }
    let result = score_pull_requests_at(vec![item], true, &[], now);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].pr.as_ref().unwrap().score, 0);
}

#[test]
fn ai_assisted_prs_score_like_any_other() {
    // Display-only until scoring weights become configurable (#45).
    let now = Utc::now();
    let mut item = make_item("pr:foo/bar#1", now);
    {
        let pr = item.pr.as_mut().unwrap();
        pr.is_review_requested_from_me = true;
        pr.ai_assist = Some(AiAssist {
            tools: vec!["Claude".to_string()],
            sources: vec![AiSource::CommitMessage],
        });
    }
    let result = score_pull_requests_at(vec![item], true, &[], now);
    assert_eq!(result[0].pr.as_ref().unwrap().score, 3);
}

fn check(conclusion: Option<&str>) -> CheckRunSummary {
    CheckRunSummary {
        name: "ci".to_string(),
        status: Some(
            if conclusion.is_some() {
                "completed"
            } else {
                "in_progress"
            }
            .to_string(),
        ),
        conclusion: conclusion.map(str::to_string),
        details_url: None,
    }
}

#[test]
fn failing_checks_do_not_move_the_score_yet() {
    // CHECKS_FAILING_WEIGHT is a 0 placeholder until weights are configurable
    // (#45): a red review request scores exactly like a green one.
    let now = Utc::now();
    let mut item = make_item("pr:foo/bar#1", now);
    {
        let pr = item.pr.as_mut().unwrap();
        pr.is_review_requested_from_me = true;
        pr.check_runs = Some(vec![check(Some("success")), check(Some("failure"))]);
    }
    assert!(has_failing_checks(item.pr.as_ref().unwrap()));
    let result = score_pull_requests_at(vec![item], true, &[], now);
    assert_eq!(result[0].pr.as_ref().unwrap().score, 3);
}

#[test]
fn failing_associated_run_counts_as_failing_checks() {
    let mut item = make_item("pr:foo/bar#1", Utc::now());
    let pr = item.pr.as_mut().unwrap();
    pr.associated_runs = Some(vec![AssociatedRun {
        workflow_name: "deploy".to_string(),
        status: "completed".to_string(),
        conclusion: Some("failure".to_string()),
        run_url: "https://github.com/foo/bar/actions/runs/1".to_string(),
        completed_at: None,
    }]);
    assert!(has_failing_checks(pr));
}

#[test]
fn green_pending_or_missing_checks_are_not_failing() {
    let mut item = make_item("pr:foo/bar#1", Utc::now());
    let pr = item.pr.as_mut().unwrap();
    assert!(!has_failing_checks(pr));
    pr.check_runs = Some(vec![
        check(Some("success")),
        check(None),
        check(Some("cancelled")),
    ]);
    assert!(!has_failing_checks(pr));
}
