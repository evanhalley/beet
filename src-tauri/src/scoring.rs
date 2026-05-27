//! The §6 PR scoring algorithm. Port of `src/lib/scoring.ts`.
//!
//! Score is computed only for PR items. The stale rule and the penalized-bot
//! rule *overwrite* the running score by design (verbatim from PRZ) — do not
//! make them additive.

use crate::poller::types::ActionableItem;
use chrono::{DateTime, Utc};

/// Whole-day difference `now - timestamp`, truncated toward zero — the
/// equivalent of dayjs `.diff(ts, "days")`. Unparseable timestamps yield 0.
fn days_since(timestamp: &str, now: DateTime<Utc>) -> i64 {
    match DateTime::parse_from_rfc3339(timestamp) {
        Ok(ts) => now.signed_duration_since(ts.with_timezone(&Utc)).num_days(),
        Err(_) => 0,
    }
}

pub fn score_pull_requests(
    items: Vec<ActionableItem>,
    show_all: bool,
    penalized_bots: &[String],
) -> Vec<ActionableItem> {
    let now = Utc::now();
    score_pull_requests_at(items, show_all, penalized_bots, now)
}

/// Testable core with an injected `now`.
pub fn score_pull_requests_at(
    mut items: Vec<ActionableItem>,
    show_all: bool,
    penalized_bots: &[String],
    now: DateTime<Utc>,
) -> Vec<ActionableItem> {
    for item in items.iter_mut() {
        let updated_at = item.updated_at.clone();
        let Some(pr) = item.pr.as_mut() else { continue };
        let mut score: i64 = 0;

        if pr.is_author_on_my_team {
            score += 6;
        }
        if pr.is_review_requested_from_me {
            score += 3;
        }
        if pr.ive_commented {
            score += 2;
        }
        if pr.ive_reviewed {
            score += 2;
        }
        if pr.ive_approved {
            score -= 100;
        }
        if pr.additions > 250 {
            score -= 1;
        }
        if pr.deletions > 250 {
            score -= 1;
        }

        if days_since(&updated_at, now) > 10 {
            score -= 1;
        }
        if days_since(&pr.created_at, now) > 60 && days_since(&updated_at, now) > 60 {
            score = 0;
        }

        // Stale (above) and penalized-bot (below) overwrite the running score
        // by design — verbatim from PRZ. Do not change to additive.
        if penalized_bots.iter().any(|b| b == &pr.author) {
            score = -10;
        }
        if pr.is_draft {
            score -= 5;
        }

        pr.score = score;
    }

    items.retain(|item| show_all || item.pr.as_ref().map(|pr| pr.score).unwrap_or(0) > 0);
    items.sort_by(|a, b| {
        let sb = b.pr.as_ref().map(|pr| pr.score).unwrap_or(0);
        let sa = a.pr.as_ref().map(|pr| pr.score).unwrap_or(0);
        sb.cmp(&sa)
    });
    items
}

#[cfg(test)]
mod tests {
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
}
