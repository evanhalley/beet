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
#[path = "__tests__/scoring.rs"]
mod tests;
