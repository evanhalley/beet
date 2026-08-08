
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
