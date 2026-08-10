
use super::*;
use crate::poller::types::{ActionableItemPr, ActionableKind, PrLifecycle};
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
            lifecycle: PrLifecycle::Open,
            merge_queue: None,
            task_urls: vec![],
            score: 0,
            reviewers: None,
            check_runs: None,
            associated_runs: None,
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
