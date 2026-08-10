
use super::*;
use crate::store::db::open_in_memory;

fn ev(id: i64, concluded_at: &str) -> RunCompletionEvent {
    RunCompletionEvent {
        run_id: id,
        repo: "foo/bar".into(),
        workflow_name: "CI".into(),
        conclusion: Some("success".into()),
        concluded_at: concluded_at.into(),
        pr_number: None,
        event: None,
        sha: None,
        run_number: None,
        actor_login: None,
        run_url: None,
        branch: None,
    }
}

#[test]
fn record_then_list_round_trips() {
    let conn = open_in_memory().unwrap();
    record_completion(&conn, &ev(1, "2026-01-02T00:00:00.000Z")).unwrap();
    record_completion(&conn, &ev(2, "2026-01-03T00:00:00.000Z")).unwrap();
    let rows = list_recent_completions(&conn, "2026-01-01T00:00:00.000Z").unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].run_id, 2); // newest first
    assert_eq!(rows[1].run_id, 1);
}

#[test]
fn since_filter_excludes_older_rows() {
    let conn = open_in_memory().unwrap();
    record_completion(&conn, &ev(1, "2025-12-31T00:00:00.000Z")).unwrap();
    record_completion(&conn, &ev(2, "2026-01-02T00:00:00.000Z")).unwrap();
    let rows = list_recent_completions(&conn, "2026-01-01T00:00:00.000Z").unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].run_id, 2);
}

#[test]
fn prune_drops_only_rows_older_than_the_cutoff() {
    let conn = open_in_memory().unwrap();
    record_completion(&conn, &ev(1, "2025-12-31T00:00:00.000Z")).unwrap();
    record_completion(&conn, &ev(2, "2026-01-02T00:00:00.000Z")).unwrap();
    let n = prune_completions_older_than(&conn, "2026-01-01T00:00:00.000Z").unwrap();
    assert_eq!(n, 1);
    let remaining = list_recent_completions(&conn, "1970-01-01T00:00:00.000Z").unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].run_id, 2);
}

#[test]
fn snapshot_fields_round_trip() {
    let conn = open_in_memory().unwrap();
    let event = RunCompletionEvent {
        run_id: 5,
        repo: "foo/bar".into(),
        workflow_name: "Deploy".into(),
        conclusion: Some("success".into()),
        concluded_at: "2026-01-02T00:00:00.000Z".into(),
        pr_number: Some(7),
        event: Some("workflow_dispatch".into()),
        sha: Some("deadbeefcafe".into()),
        run_number: Some(42),
        actor_login: Some("evan".into()),
        run_url: Some("https://github.com/foo/bar/actions/runs/5".into()),
        branch: Some("main".into()),
    };
    record_completion(&conn, &event).unwrap();
    let rows = list_recent_completions(&conn, "1970-01-01T00:00:00.000Z").unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0], event);
}

#[test]
fn insert_or_ignore_dedupes_on_run_id() {
    let conn = open_in_memory().unwrap();
    record_completion(&conn, &ev(1, "2026-01-02T00:00:00.000Z")).unwrap();
    // Second observation of the same run with a different conclusion does
    // *not* overwrite — we only ever record the first terminal state.
    let mut second = ev(1, "2026-01-03T00:00:00.000Z");
    second.conclusion = Some("failure".into());
    record_completion(&conn, &second).unwrap();
    let rows = list_recent_completions(&conn, "2026-01-01T00:00:00.000Z").unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].conclusion.as_deref(), Some("success"));
}
