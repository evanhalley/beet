//! Mock mode (demo / offline feature-testing).
//!
//! When the process is launched with `BEET_MOCK=1`, the poll loop skips all
//! GitHub access and emits the static fixture in this module instead, and the
//! on-demand jobs command returns canned data. The rest of the app — tray
//! badge, window, notifications, sections, detail pane, and the SQLite-backed
//! mute/pin/suppress features — runs exactly as in production.
//!
//! The fixture is built programmatically as `crate::poller::types::*` values so
//! it is compiler-checked against the same contract the frontend deserializes.
//! Timestamps are relative to "now" so the UI's relative-time rendering and the
//! 24h Recently-Resolved window look right whenever the app is launched.
//!
//! ## The scenario: **The Cypher**
//!
//! The data is modeled on a real-ish web product: the engineering team at *The
//! Cypher*, a hip-hop magazine, building and operating its website (a content
//! blog) plus the services behind it. Repos:
//!
//! - `thecypher/web`            — the Next.js magazine site (articles, reviews, tag feeds)
//! - `thecypher/cms`            — editorial CMS (drafting, scheduling, media)
//! - `thecypher/api`            — content + charts API
//! - `thecypher/design-system`  — shared React component library
//! - `thecypher/ingest`         — charts / release-calendar data pipelines
//! - `thecypher/infra`          — deploy + ops automation
//!
//! Authors are teammates; `evan` is "me".

use crate::github::client::RateLimitInfo;
use crate::github::runs::WorkflowJobSummary;
use crate::poller::types::{
    ActionableItem, ActionableItemMergeQueue, ActionableItemPr, ActionableItemRun, ActionableKind,
    AssociatedRun, CheckRunSummary, EjectedCheck, PrLifecycle, ReviewerEntry,
};
use chrono::SecondsFormat;

/// True when the process was started with `BEET_MOCK=1`. Read from the
/// environment so the poll loop and the `fetch_run_jobs` / `is_mock_mode`
/// commands all agree without extra plumbing.
pub fn is_enabled() -> bool {
    matches!(std::env::var("BEET_MOCK").as_deref(), Ok("1"))
}

/// Tauri command backing the frontend's mock-mode check (used to suppress the
/// missing-token banner so the populated UI renders without a PAT).
#[tauri::command]
pub fn is_mock_mode() -> bool {
    is_enabled()
}

/// The four section lists plus a representative rate-limit reading, mirroring
/// the shape the poll loop emits as `poll:result`.
pub struct MockLists {
    pub review_requests: Vec<ActionableItem>,
    pub in_flight: Vec<ActionableItem>,
    pub standalone_runs: Vec<ActionableItem>,
    pub recently_resolved: Vec<ActionableItem>,
    pub rate_limit: Option<RateLimitInfo>,
}

/// `minutes` ago, formatted like `now_iso` (millis, `Z`).
fn ago_min(minutes: i64) -> String {
    (chrono::Utc::now() - chrono::Duration::minutes(minutes))
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// `days` ago, same format.
fn ago_days(days: i64) -> String {
    ago_min(days * 24 * 60)
}

const ME: &str = "evan";

fn reviewer(login: &str, state: &str) -> ReviewerEntry {
    ReviewerEntry {
        login: login.to_string(),
        state: state.to_string(),
    }
}

fn check(name: &str, status: &str, conclusion: Option<&str>) -> CheckRunSummary {
    CheckRunSummary {
        name: name.to_string(),
        status: Some(status.to_string()),
        conclusion: conclusion.map(|c| c.to_string()),
        details_url: None,
    }
}

/// A PR `ActionableItemPr` with neutral defaults. Callers tweak the handful of
/// fields that make each fixture row distinct.
fn default_pr(number: i64, author: &str) -> ActionableItemPr {
    ActionableItemPr {
        number,
        author: author.to_string(),
        body: Some(format!(
            "Part of *The Cypher* website work (mock PR #{number}).\n\nRenders in the detail pane as Markdown."
        )),
        is_authored_by_me: false,
        is_review_requested_from_me: false,
        is_author_on_my_team: false,
        ive_commented: false,
        ive_reviewed: false,
        ive_approved: false,
        approval_count: 0,
        is_draft: false,
        additions: 40,
        deletions: 12,
        created_at: ago_days(2),
        lifecycle: PrLifecycle::InReview,
        merge_queue: None,
        task_urls: Vec::new(),
        score: 0,
        reviewers: None,
        check_runs: None,
        associated_runs: None,
    }
}

fn pr_item(
    repo: &str,
    pr: ActionableItemPr,
    title: &str,
    updated_min: i64,
    unread: bool,
) -> ActionableItem {
    let number = pr.number;
    ActionableItem {
        id: format!("pr:{repo}#{number}"),
        kind: ActionableKind::Pr,
        title: title.to_string(),
        url: format!("https://github.com/{repo}/pull/{number}"),
        repo_full_name: repo.to_string(),
        updated_at: ago_min(updated_min),
        unread,
        dismissed_until_fingerprint: None,
        pr: Some(pr),
        run: None,
    }
}

#[allow(clippy::too_many_arguments)] // fixture builder; positional args read fine
fn run_item(
    repo: &str,
    run_id: i64,
    workflow_name: &str,
    event: &str,
    status: &str,
    conclusion: Option<&str>,
    updated_min: i64,
    unread: bool,
) -> ActionableItem {
    let completed_at = if status == "completed" {
        Some(ago_min(updated_min))
    } else {
        None
    };
    ActionableItem {
        id: format!("run:{repo}#{run_id}"),
        kind: ActionableKind::StandaloneRun,
        title: workflow_name.to_string(),
        url: format!("https://github.com/{repo}/actions/runs/{run_id}"),
        repo_full_name: repo.to_string(),
        updated_at: ago_min(updated_min),
        unread,
        dismissed_until_fingerprint: None,
        pr: None,
        run: Some(ActionableItemRun {
            workflow_name: workflow_name.to_string(),
            event: event.to_string(),
            status: status.to_string(),
            conclusion: conclusion.map(|c| c.to_string()),
            branch: Some("main".to_string()),
            sha: "9f3c1ab".to_string(),
            run_number: run_id % 1000,
            actor_login: ME.to_string(),
            run_url: format!("https://github.com/{repo}/actions/runs/{run_id}"),
            started_at: Some(ago_min(updated_min + 6)),
            completed_at,
        }),
    }
}

/// The static demo dataset for *The Cypher* (see module docs). Deliberately
/// varied so every UI surface is exercised: 6 visible review requests plus a
/// hidden approved one and a hidden draft (Show-All reveals them); 6 in-flight
/// PRs including a merge-queue position and a merge-queue ejection; three
/// standalone runs (in-progress, failed, succeeded); and several distinct repos
/// so org/repo mute & pin are demoable.
pub fn mock_payload() -> MockLists {
    // ---- Review Requests (PRs awaiting my review) -------------------------

    // High score: author on my team (+6) and I'm a requested reviewer (+3);
    // big diff trims it by 1. Failing checks + mixed reviewers; unread so it
    // drives the tray badge.
    let mut web_tag_pages = default_pr(1284, "maya-r");
    web_tag_pages.is_review_requested_from_me = true;
    web_tag_pages.is_author_on_my_team = true;
    web_tag_pages.score = 8;
    web_tag_pages.additions = 312;
    web_tag_pages.deletions = 24;
    web_tag_pages.task_urls = vec!["https://linear.app/thecypher/issue/WEB-742".to_string()];
    web_tag_pages.reviewers = vec![
        reviewer(ME, "requested"),
        reviewer("deon-k", "changes_requested"),
    ]
    .into();
    web_tag_pages.check_runs = vec![
        check("build", "completed", Some("success")),
        check("e2e", "completed", Some("failure")),
        check("lighthouse", "in_progress", None),
    ]
    .into();

    // Requested reviewer (+3) and I've commented (+2).
    let mut web_hero_cls = default_pr(1290, "priya-s");
    web_hero_cls.is_review_requested_from_me = true;
    web_hero_cls.ive_commented = true;
    web_hero_cls.score = 5;
    web_hero_cls.reviewers = vec![reviewer(ME, "commented")].into();
    web_hero_cls.check_runs = vec![
        check("build", "completed", Some("success")),
        check("typecheck", "completed", Some("success")),
    ]
    .into();

    // Team author (+6) + requested (+3); clean checks.
    let mut api_charts = default_pr(508, "marcus-l");
    api_charts.is_review_requested_from_me = true;
    api_charts.is_author_on_my_team = true;
    api_charts.score = 9;
    api_charts.additions = 180;
    api_charts.task_urls = vec!["https://linear.app/thecypher/issue/API-219".to_string()];
    api_charts.reviewers = vec![reviewer(ME, "requested"), reviewer("lena-w", "approved")].into();
    api_charts.check_runs = vec![
        check("test", "completed", Some("success")),
        check("contract", "completed", Some("success")),
    ]
    .into();

    // Requested reviewer (+3); editorial CMS feature.
    let mut cms_schedule = default_pr(431, "deon-k");
    cms_schedule.is_review_requested_from_me = true;
    cms_schedule.score = 3;
    cms_schedule.reviewers = vec![reviewer(ME, "requested")].into();
    cms_schedule.check_runs = vec![check("build", "completed", Some("success"))].into();

    // Requested reviewer (+3); small design-system PR.
    let mut ds_rating = default_pr(96, "lena-w");
    ds_rating.is_review_requested_from_me = true;
    ds_rating.score = 3;
    ds_rating.additions = 64;
    ds_rating.deletions = 4;
    ds_rating.reviewers = vec![reviewer(ME, "requested")].into();
    ds_rating.check_runs = vec![
        check("build", "completed", Some("success")),
        check("visual-regression", "completed", Some("success")),
    ]
    .into();

    // Requested reviewer (+3); ingest pipeline change.
    let mut ingest_calendar = default_pr(212, "priya-s");
    ingest_calendar.is_review_requested_from_me = true;
    ingest_calendar.score = 3;
    ingest_calendar.reviewers = vec![reviewer(ME, "requested")].into();
    ingest_calendar.check_runs = vec![check("test", "in_progress", None)].into();

    // Approved by me → strongly negative score: hidden unless Show-All.
    let mut ds_approved = default_pr(91, "marcus-l");
    ds_approved.is_review_requested_from_me = true;
    ds_approved.ive_reviewed = true;
    ds_approved.ive_approved = true;
    ds_approved.approval_count = 2;
    ds_approved.score = -97;
    ds_approved.reviewers = vec![reviewer(ME, "approved")].into();

    // Draft → negative score: also hidden unless Show-All.
    let mut web_infinite_scroll = default_pr(1301, "deon-k");
    web_infinite_scroll.is_review_requested_from_me = true;
    web_infinite_scroll.is_draft = true;
    web_infinite_scroll.score = -2;
    web_infinite_scroll.lifecycle = PrLifecycle::Open;

    let review_requests = vec![
        pr_item(
            "thecypher/web",
            web_tag_pages,
            "Artist tag pages with related-article rails",
            18,
            true,
        ),
        pr_item(
            "thecypher/web",
            web_hero_cls,
            "Fix layout shift on the homepage hero carousel",
            52,
            false,
        ),
        pr_item(
            "thecypher/api",
            api_charts,
            "Add /charts endpoint backed by the Billboard ingest",
            90,
            true,
        ),
        pr_item(
            "thecypher/cms",
            cms_schedule,
            "Editorial: schedule articles for future publish",
            60 * 3,
            false,
        ),
        pr_item(
            "thecypher/design-system",
            ds_rating,
            "New ReviewScore rating component (1–5 mics)",
            60 * 5,
            false,
        ),
        pr_item(
            "thecypher/ingest",
            ingest_calendar,
            "Pull the new-release calendar from MusicBrainz",
            60 * 7,
            false,
        ),
        pr_item(
            "thecypher/design-system",
            ds_approved,
            "Tokenize spacing scale for the reading view",
            60 * 9,
            false,
        ),
        pr_item(
            "thecypher/web",
            web_infinite_scroll,
            "WIP: infinite scroll on tag feeds",
            60 * 30,
            false,
        ),
    ];

    // ---- In Flight (my own open PRs) --------------------------------------

    // In the merge queue at position 2, CI still running. Unread.
    let mut web_ssr = default_pr(1276, ME);
    web_ssr.is_authored_by_me = true;
    web_ssr.lifecycle = PrLifecycle::MergeQueue;
    web_ssr.approval_count = 2;
    web_ssr.merge_queue = Some(ActionableItemMergeQueue {
        position: Some(2),
        entered_at: ago_min(14),
        last_ejection_at: None,
        ejected_checks: None,
        head_sha: Some("a1b2c3d".into()),
        pr_node_id: Some("PR_kwDOMockWeb1276".into()),
    });
    web_ssr.reviewers = vec![
        reviewer("maya-r", "approved"),
        reviewer("lena-w", "approved"),
    ]
    .into();
    web_ssr.associated_runs = vec![AssociatedRun {
        workflow_name: "CI".into(),
        status: "in_progress".into(),
        conclusion: None,
        run_url: "https://github.com/thecypher/web/actions/runs/77001".into(),
        completed_at: None,
    }]
    .into();

    // Recently ejected from the merge queue (the high-priority surface). Unread.
    let mut web_newsletter = default_pr(1281, ME);
    web_newsletter.is_authored_by_me = true;
    web_newsletter.lifecycle = PrLifecycle::InReview;
    web_newsletter.merge_queue = Some(ActionableItemMergeQueue {
        position: None,
        entered_at: ago_min(55),
        last_ejection_at: Some(ago_min(8)),
        ejected_checks: Some(vec![EjectedCheck {
            name: "e2e".into(),
            conclusion: "failure".into(),
            details_url: Some("https://github.com/thecypher/web/actions/runs/77010".into()),
        }]),
        head_sha: Some("d4e5f60".into()),
        pr_node_id: Some("PR_kwDOMockWeb1281".into()),
    });
    web_newsletter.check_runs = vec![
        check("build", "completed", Some("success")),
        check("e2e", "completed", Some("failure")),
    ]
    .into();

    // Open, healthy, one approval.
    let mut api_redis = default_pr(503, ME);
    api_redis.is_authored_by_me = true;
    api_redis.lifecycle = PrLifecycle::InReview;
    api_redis.approval_count = 1;
    api_redis.reviewers = vec![reviewer("marcus-l", "approved")].into();
    api_redis.check_runs = vec![
        check("test", "completed", Some("success")),
        check("contract", "completed", Some("success")),
    ]
    .into();

    // Open, review in progress.
    let mut cms_alt_text = default_pr(427, ME);
    cms_alt_text.is_authored_by_me = true;
    cms_alt_text.lifecycle = PrLifecycle::InReview;
    cms_alt_text.reviewers = vec![reviewer("priya-s", "changes_requested")].into();
    cms_alt_text.check_runs = vec![check("build", "completed", Some("success"))].into();

    // Open, checks running.
    let mut ds_dark_mode = default_pr(88, ME);
    ds_dark_mode.is_authored_by_me = true;
    ds_dark_mode.lifecycle = PrLifecycle::InReview;
    ds_dark_mode.check_runs = vec![
        check("build", "completed", Some("success")),
        check("visual-regression", "in_progress", None),
    ]
    .into();

    // Freshly opened, no reviews yet.
    let mut ingest_charts = default_pr(207, ME);
    ingest_charts.is_authored_by_me = true;
    ingest_charts.lifecycle = PrLifecycle::Open;
    ingest_charts.created_at = ago_min(40);
    ingest_charts.check_runs = vec![check("test", "queued", None)].into();

    let in_flight = vec![
        pr_item(
            "thecypher/web",
            web_ssr,
            "Server-render article pages for SEO",
            14,
            true,
        ),
        pr_item(
            "thecypher/web",
            web_newsletter,
            "Newsletter signup modal (A/B test)",
            8,
            true,
        ),
        pr_item(
            "thecypher/api",
            api_redis,
            "Cache the trending-articles query in Redis",
            60,
            false,
        ),
        pr_item(
            "thecypher/cms",
            cms_alt_text,
            "Bulk image alt-text editor for the media library",
            60 * 2,
            false,
        ),
        pr_item(
            "thecypher/design-system",
            ds_dark_mode,
            "Dark-mode tokens for the reading view",
            60 * 4,
            false,
        ),
        pr_item(
            "thecypher/ingest",
            ingest_charts,
            "Backfill weekly chart positions from 2019",
            40,
            false,
        ),
    ];

    // ---- Standalone Runs (my workflow runs not tied to a tracked PR) ------

    let standalone_runs = vec![
        run_item(
            "thecypher/infra",
            78001,
            "Deploy Production",
            "workflow_dispatch",
            "in_progress",
            None,
            3,
            true,
        ),
        run_item(
            "thecypher/infra",
            78000,
            "Lighthouse CI",
            "schedule",
            "completed",
            Some("failure"),
            65,
            false,
        ),
        run_item(
            "thecypher/web",
            77990,
            "Nightly E2E",
            "schedule",
            "completed",
            Some("success"),
            120,
            false,
        ),
    ];

    // ---- Recently Resolved (merged/closed in the last 24h) ----------------

    let mut web_footer = default_pr(1270, ME);
    web_footer.is_authored_by_me = true;
    web_footer.lifecycle = PrLifecycle::Merged;
    let web_footer_item = pr_item(
        "thecypher/web",
        web_footer,
        "Redesign the article footer share bar",
        60 * 6,
        false,
    );

    let recently_resolved = vec![
        web_footer_item,
        run_item(
            "thecypher/infra",
            77980,
            "Deploy Production",
            "workflow_dispatch",
            "completed",
            Some("success"),
            60 * 7,
            false,
        ),
    ];

    MockLists {
        review_requests,
        in_flight,
        standalone_runs,
        recently_resolved,
        rate_limit: Some(RateLimitInfo {
            remaining: 4987,
            limit: 5000,
            reset: (chrono::Utc::now() + chrono::Duration::minutes(42)).timestamp(),
        }),
    }
}

/// Canned jobs for the DetailPane's run-jobs view in mock mode. Modeled on a
/// production deploy of the website.
pub fn mock_run_jobs() -> Vec<WorkflowJobSummary> {
    vec![
        WorkflowJobSummary {
            id: 1,
            name: "install-and-build".into(),
            status: "completed".into(),
            conclusion: Some("success".into()),
            started_at: Some(ago_min(18)),
            completed_at: Some(ago_min(14)),
            html_url: Some("https://github.com/thecypher/infra/actions/runs/78000/job/1".into()),
        },
        WorkflowJobSummary {
            id: 2,
            name: "lighthouse-audit".into(),
            status: "completed".into(),
            conclusion: Some("failure".into()),
            started_at: Some(ago_min(14)),
            completed_at: Some(ago_min(10)),
            html_url: Some("https://github.com/thecypher/infra/actions/runs/78000/job/2".into()),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sections_meet_the_demo_minimums() {
        let lists = mock_payload();
        // At least 5 review requests and 5 in-flight PRs (the demo brief), a
        // few standalone runs, and a rate-limit reading.
        assert!(lists.review_requests.len() >= 5);
        assert!(lists.in_flight.len() >= 5);
        assert!(lists.standalone_runs.len() >= 3);
        assert!(!lists.recently_resolved.is_empty());
        assert!(lists.rate_limit.is_some());
    }

    #[test]
    fn at_least_three_distinct_repos() {
        let lists = mock_payload();
        let mut repos: Vec<&str> = lists
            .review_requests
            .iter()
            .chain(&lists.in_flight)
            .chain(&lists.standalone_runs)
            .map(|i| i.repo_full_name.as_str())
            .collect();
        repos.sort_unstable();
        repos.dedup();
        assert!(repos.len() >= 3, "expected 3+ repos, got {repos:?}");
    }

    #[test]
    fn payload_serializes_to_the_frontend_contract() {
        // Every fixture row must round-trip through the same ActionableItem
        // structs the frontend deserializes, with no panic.
        let lists = mock_payload();
        for item in lists
            .review_requests
            .iter()
            .chain(&lists.in_flight)
            .chain(&lists.standalone_runs)
            .chain(&lists.recently_resolved)
        {
            let json = serde_json::to_value(item).unwrap();
            assert!(json["id"].is_string());
            let back: ActionableItem = serde_json::from_value(json).unwrap();
            assert_eq!(&back, item);
        }
    }

    #[test]
    fn fixture_exercises_key_surfaces() {
        let lists = mock_payload();
        // A hidden-until-Show-All row (score <= 0).
        assert!(lists.review_requests.iter().any(|i| i
            .pr
            .as_ref()
            .map(|p| p.score <= 0)
            .unwrap_or(false)));
        // At least 5 *visible* review requests (positive score).
        let visible = lists
            .review_requests
            .iter()
            .filter(|i| i.pr.as_ref().map(|p| p.score > 0).unwrap_or(false))
            .count();
        assert!(
            visible >= 5,
            "expected 5+ visible review requests, got {visible}"
        );
        // A merge-queue ejection surface.
        assert!(lists.in_flight.iter().any(|i| i
            .pr
            .as_ref()
            .and_then(|p| p.merge_queue.as_ref())
            .map(|mq| mq.last_ejection_at.is_some())
            .unwrap_or(false)));
        // A merge-queue position.
        assert!(lists.in_flight.iter().any(|i| i
            .pr
            .as_ref()
            .and_then(|p| p.merge_queue.as_ref())
            .map(|mq| mq.position.is_some())
            .unwrap_or(false)));
        // At least one unread item to drive the tray badge.
        assert!(lists.review_requests.iter().any(|i| i.unread));
    }

    #[test]
    fn is_enabled_reads_the_env_var() {
        // The result depends on the ambient env; just assert the helper is a
        // pure function of BEET_MOCK without panicking.
        let _ = is_enabled();
    }

    #[test]
    fn mock_jobs_are_non_empty() {
        assert!(!mock_run_jobs().is_empty());
    }
}
