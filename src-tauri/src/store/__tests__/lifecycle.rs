
use super::*;
use crate::store::db::open_in_memory;

#[test]
fn record_lifecycle_only_inserts_on_transition() {
    let conn = open_in_memory().unwrap();
    // `observed_at` (millisecond precision) is part of the PK; real
    // transitions are minutes apart, so space the test inserts out.
    record_lifecycle(
        &conn,
        "pr:foo/bar#1",
        PrLifecycle::Open,
        &PrSnapshot::default(),
    )
    .unwrap();
    record_lifecycle(
        &conn,
        "pr:foo/bar#1",
        PrLifecycle::Open,
        &PrSnapshot::default(),
    )
    .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(2));
    record_lifecycle(
        &conn,
        "pr:foo/bar#1",
        PrLifecycle::InReview,
        &PrSnapshot::default(),
    )
    .unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM pr_lifecycle_history WHERE pr_id = 'pr:foo/bar#1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 2);
    assert_eq!(
        get_latest_lifecycle(&conn, "pr:foo/bar#1").unwrap(),
        Some(PrLifecycle::InReview)
    );
}

#[test]
fn detect_ejection_fires_only_on_queue_exit_not_into_merged() {
    let conn = open_in_memory().unwrap();
    let pr = "pr:foo/bar#2";
    record_lifecycle(&conn, pr, PrLifecycle::MergeQueue, &PrSnapshot::default()).unwrap();
    assert!(detect_ejection(&conn, pr, PrLifecycle::Open).unwrap());
    assert!(detect_ejection(&conn, pr, PrLifecycle::InReview).unwrap());
    assert!(!detect_ejection(&conn, pr, PrLifecycle::Merged).unwrap());
    assert!(!detect_ejection(&conn, pr, PrLifecycle::MergeQueue).unwrap());
}

#[test]
fn detect_ejection_false_when_not_previously_in_queue() {
    let conn = open_in_memory().unwrap();
    let pr = "pr:foo/bar#3";
    record_lifecycle(&conn, pr, PrLifecycle::Open, &PrSnapshot::default()).unwrap();
    assert!(!detect_ejection(&conn, pr, PrLifecycle::Closed).unwrap());
}

#[test]
fn ejection_event_round_trips() {
    let conn = open_in_memory().unwrap();
    let pr = "pr:foo/bar#4";
    let checks = vec![EjectedCheck {
        name: "ci/test".to_string(),
        conclusion: "failure".to_string(),
        details_url: Some("https://example.com".to_string()),
    }];
    record_ejection_event(&conn, pr, "abc123", &checks).unwrap();
    let event = get_latest_ejection_event(&conn, pr).unwrap().unwrap();
    assert_eq!(event.head_sha, "abc123");
    assert_eq!(event.failing_checks, checks);
}

#[test]
fn get_latest_ejection_event_none_when_absent() {
    let conn = open_in_memory().unwrap();
    assert_eq!(get_latest_ejection_event(&conn, "nope").unwrap(), None);
}

#[test]
fn list_recently_resolved_excludes_open_and_old_rows() {
    let conn = open_in_memory().unwrap();
    // pr 1: closed today -> included
    conn.execute(
        "INSERT INTO pr_lifecycle_history (pr_id, lifecycle, observed_at)
             VALUES ('pr:foo/bar#1', 'merged', '2026-05-18T12:00:00.000Z')",
        [],
    )
    .unwrap();
    // pr 2: open today -> excluded (not merged/closed)
    conn.execute(
        "INSERT INTO pr_lifecycle_history (pr_id, lifecycle, observed_at)
             VALUES ('pr:foo/bar#2', 'open', '2026-05-18T12:00:00.000Z')",
        [],
    )
    .unwrap();
    // pr 3: merged a week ago -> excluded by since filter
    conn.execute(
        "INSERT INTO pr_lifecycle_history (pr_id, lifecycle, observed_at)
             VALUES ('pr:foo/bar#3', 'merged', '2026-05-10T12:00:00.000Z')",
        [],
    )
    .unwrap();
    let rows = list_recently_resolved_pr_ids(&conn, "2026-05-17T00:00:00.000Z").unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].pr_id, "pr:foo/bar#1");
    assert_eq!(rows[0].lifecycle, PrLifecycle::Merged);
}

#[test]
fn list_recently_resolved_ignores_reopened_prs() {
    // Regression: a PR merged inside the window then reopened to "open"
    // must NOT surface. The fix joins against the latest observation per
    // PR (regardless of lifecycle), then filters on terminal state.
    let conn = open_in_memory().unwrap();
    conn.execute(
        "INSERT INTO pr_lifecycle_history (pr_id, lifecycle, observed_at)
             VALUES ('pr:foo/bar#9', 'merged', '2026-05-18T10:00:00.000Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO pr_lifecycle_history (pr_id, lifecycle, observed_at)
             VALUES ('pr:foo/bar#9', 'open', '2026-05-18T11:00:00.000Z')",
        [],
    )
    .unwrap();
    let rows = list_recently_resolved_pr_ids(&conn, "2026-05-17T00:00:00.000Z").unwrap();
    assert!(rows.is_empty(), "reopened PRs must not surface as resolved");
}

#[test]
fn record_lifecycle_persists_snapshot_columns() {
    let conn = open_in_memory().unwrap();
    let snap = PrSnapshot {
        title: Some("Fix the thing".to_string()),
        author: Some("rina".to_string()),
        url: Some("https://github.com/foo/bar/pull/7".to_string()),
    };
    record_lifecycle(&conn, "pr:foo/bar#7", PrLifecycle::Merged, &snap).unwrap();
    let rows = list_recently_resolved_pr_ids(&conn, "1970-01-01T00:00:00.000Z").unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].snapshot, snap);
}
