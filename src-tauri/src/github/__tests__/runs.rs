
use super::*;
use crate::github::models::RunPullRequestRef;

fn run(
    id: i64,
    repo_pr_numbers: &[i64],
    status: &str,
    conclusion: Option<&str>,
    updated_at: &str,
    workflow: &str,
) -> WorkflowRun {
    WorkflowRun {
        id,
        name: Some(workflow.into()),
        display_title: None,
        status: status.into(),
        conclusion: conclusion.map(|s| s.into()),
        event: "push".into(),
        html_url: format!("https://github.com/foo/bar/actions/runs/{id}"),
        created_at: updated_at.into(),
        updated_at: updated_at.into(),
        run_started_at: None,
        head_branch: Some("main".into()),
        head_sha: "deadbeef".into(),
        run_number: id,
        actor: None,
        pull_requests: if repo_pr_numbers.is_empty() {
            None
        } else {
            Some(
                repo_pr_numbers
                    .iter()
                    .map(|n| RunPullRequestRef { number: *n })
                    .collect(),
            )
        },
    }
}

fn tracked(pr_id: &str, owner: &str, repo: &str, n: i64) -> (String, (String, String, i64)) {
    (pr_id.to_string(), (owner.to_string(), repo.to_string(), n))
}

fn with_repo(repo: &str, run: WorkflowRun) -> RunWithRepo {
    RunWithRepo {
        repo_full_name: repo.to_string(),
        run,
    }
}

#[test]
fn collapse_attaches_runs_to_tracked_prs_and_drops_them_from_standalone() {
    let tracked: HashMap<_, _> = [tracked("pr:foo/bar#1", "foo", "bar", 1)]
        .into_iter()
        .collect();
    let runs = vec![with_repo(
        "foo/bar",
        run(
            10,
            &[1],
            "completed",
            Some("success"),
            "2026-01-01T01:00:00.000Z",
            "CI",
        ),
    )];
    let out = collapse_runs(runs, &tracked, "evan");
    assert_eq!(out.standalone.len(), 0);
    let attached = out.attached.get("pr:foo/bar#1").unwrap();
    assert_eq!(attached.len(), 1);
    assert_eq!(attached[0].workflow_name, "CI");
}

#[test]
fn collapse_keeps_only_most_recent_run_per_workflow_per_pr() {
    let tracked: HashMap<_, _> = [tracked("pr:foo/bar#1", "foo", "bar", 1)]
        .into_iter()
        .collect();
    let runs = vec![
        with_repo(
            "foo/bar",
            run(
                10,
                &[1],
                "completed",
                Some("failure"),
                "2026-01-01T00:00:00.000Z",
                "CI",
            ),
        ),
        with_repo(
            "foo/bar",
            run(
                11,
                &[1],
                "completed",
                Some("success"),
                "2026-01-01T02:00:00.000Z",
                "CI",
            ),
        ),
        with_repo(
            "foo/bar",
            run(
                12,
                &[1],
                "in_progress",
                None,
                "2026-01-01T03:00:00.000Z",
                "Deploy",
            ),
        ),
    ];
    let out = collapse_runs(runs, &tracked, "evan");
    let attached = out.attached.get("pr:foo/bar#1").unwrap();
    assert_eq!(attached.len(), 2);
    let ci = attached.iter().find(|r| r.workflow_name == "CI").unwrap();
    assert_eq!(ci.conclusion.as_deref(), Some("success"));
    let deploy = attached
        .iter()
        .find(|r| r.workflow_name == "Deploy")
        .unwrap();
    assert_eq!(deploy.status, "in_progress");
    assert!(deploy.completed_at.is_none());
}

#[test]
fn collapse_surfaces_orphan_and_push_event_runs_as_standalone() {
    let tracked: HashMap<_, _> = HashMap::new();
    let runs = vec![
        with_repo(
            "foo/bar",
            run(
                20,
                &[],
                "completed",
                Some("success"),
                "2026-01-01T00:00:00.000Z",
                "Deploy",
            ),
        ),
        with_repo(
            "foo/bar",
            run(
                21,
                &[999],
                "in_progress",
                None,
                "2026-01-01T00:01:00.000Z",
                "CI",
            ),
        ),
    ];
    let out = collapse_runs(runs, &tracked, "evan");
    assert_eq!(out.attached.len(), 0);
    assert_eq!(out.standalone.len(), 2);
    for item in &out.standalone {
        assert_eq!(item.kind, ActionableKind::StandaloneRun);
        assert!(item.pr.is_none());
        assert!(item.run.is_some());
        assert!(item.id.starts_with("run:foo/bar#"));
    }
}

#[test]
fn collapse_does_not_match_pr_numbers_across_different_repos() {
    // A PR #1 in foo/bar must not collect a run from baz/qux that also
    // claims pull_requests[].number == 1.
    let tracked: HashMap<_, _> = [tracked("pr:foo/bar#1", "foo", "bar", 1)]
        .into_iter()
        .collect();
    let runs = vec![with_repo(
        "baz/qux",
        run(
            30,
            &[1],
            "completed",
            Some("success"),
            "2026-01-01T00:00:00.000Z",
            "CI",
        ),
    )];
    let out = collapse_runs(runs, &tracked, "evan");
    assert!(out.attached.is_empty());
    assert_eq!(out.standalone.len(), 1);
    assert_eq!(out.standalone[0].repo_full_name, "baz/qux");
}

fn standalone(repo: &str, run_id: i64, workflow: &str, updated_at: &str) -> ActionableItem {
    to_actionable_run(
        &run(
            run_id,
            &[],
            "completed",
            Some("success"),
            updated_at,
            workflow,
        ),
        repo,
        "evan",
    )
}

#[test]
fn dedupe_standalone_keeps_newest_per_workflow_per_repo() {
    let runs = vec![
        standalone("foo/bar", 1, "CI", "2026-01-01T00:00:00.000Z"),
        standalone("foo/bar", 2, "CI", "2026-01-02T00:00:00.000Z"), // newest CI
        standalone("foo/bar", 3, "Deploy", "2026-01-01T12:00:00.000Z"),
        standalone("baz/qux", 4, "CI", "2026-01-01T11:00:00.000Z"),
    ];
    let out = dedupe_standalone(runs);
    assert_eq!(out.len(), 3);
    // foo/bar / CI keeps run #2
    let foo_ci = out
        .iter()
        .find(|i| i.repo_full_name == "foo/bar" && i.title == "CI")
        .unwrap();
    assert!(foo_ci.id.ends_with("#2"));
    // baz/qux / CI is independent of foo/bar / CI
    assert!(out.iter().any(|i| i.repo_full_name == "baz/qux"));
    // Sorted newest-first
    for w in out.windows(2) {
        assert!(w[0].updated_at >= w[1].updated_at);
    }
}

#[test]
fn apply_standalone_allowlist_filters_to_listed_workflows_only() {
    let runs = vec![
        standalone("foo/bar", 1, "CI", "2026-01-01T00:00:00.000Z"),
        standalone("foo/bar", 2, "Deploy", "2026-01-02T00:00:00.000Z"),
        standalone("foo/bar", 3, "Lint", "2026-01-01T01:00:00.000Z"),
    ];
    let mut allowlist = HashMap::new();
    allowlist.insert("foo/bar".to_string(), vec!["deploy".to_string()]);
    // case-insensitive trim — "deploy" in config matches "Deploy" run.
    let out = apply_standalone_allowlist(runs, &allowlist);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].title, "Deploy");
}

#[test]
fn apply_standalone_allowlist_passes_through_repos_with_no_entry() {
    let runs = vec![
        standalone("foo/bar", 1, "CI", "2026-01-01T00:00:00.000Z"),
        standalone("baz/qux", 2, "CI", "2026-01-01T00:00:00.000Z"),
    ];
    let mut allowlist = HashMap::new();
    // Only foo/bar is filtered; baz/qux has no entry → pass-through.
    allowlist.insert("foo/bar".to_string(), vec!["Deploy".to_string()]);
    let out = apply_standalone_allowlist(runs, &allowlist);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].repo_full_name, "baz/qux");
}

#[test]
fn apply_standalone_allowlist_empty_entry_is_pass_through() {
    let runs = vec![standalone("foo/bar", 1, "CI", "2026-01-01T00:00:00.000Z")];
    let mut allowlist = HashMap::new();
    allowlist.insert("foo/bar".to_string(), Vec::new());
    let out = apply_standalone_allowlist(runs, &allowlist);
    assert_eq!(out.len(), 1);
}

#[test]
fn apply_standalone_allowlist_empty_map_is_pass_through() {
    let runs = vec![standalone("foo/bar", 1, "CI", "2026-01-01T00:00:00.000Z")];
    let out = apply_standalone_allowlist(runs, &HashMap::new());
    assert_eq!(out.len(), 1);
}

#[tokio::test]
async fn fetch_run_jobs_parses_and_caches() {
    use crate::store::db::open_in_memory;
    use crate::store::etag_cache::get_cached;
    use std::sync::Mutex;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/foo/bar/actions/runs/42/jobs"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("etag", "\"v1\"")
                .set_body_json(serde_json::json!({
                    "jobs": [
                        {
                            "id": 100,
                            "name": "build",
                            "status": "completed",
                            "conclusion": "success",
                            "started_at": "2026-01-01T00:00:00Z",
                            "completed_at": "2026-01-01T00:02:00Z",
                            "html_url": "https://github.com/foo/bar/actions/runs/42/job/100"
                        },
                        {
                            "id": 101,
                            "name": "test",
                            "status": "in_progress",
                            "conclusion": null,
                            "started_at": "2026-01-01T00:00:05Z",
                            "completed_at": null,
                            "html_url": null
                        }
                    ]
                })),
        )
        .mount(&server)
        .await;

    let db: Db = Mutex::new(open_in_memory().unwrap());
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let jobs = fetch_run_jobs(&client, &db, "foo", "bar", 42)
        .await
        .unwrap();

    assert_eq!(jobs.len(), 2);
    assert_eq!(jobs[0].name, "build");
    assert_eq!(jobs[0].conclusion.as_deref(), Some("success"));
    assert_eq!(jobs[1].status, "in_progress");
    assert!(jobs[1].conclusion.is_none());

    // ETag cache primed under the documented key.
    let conn = db.lock().unwrap();
    let cached = get_cached(&conn, "runs:foo/bar#42:jobs").unwrap().unwrap();
    assert_eq!(cached.etag, "\"v1\"");
}

#[test]
fn iso_window_start_returns_a_past_timestamp() {
    let start = iso_window_start(24);
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    assert!(start < now, "{start} should sort before {now}");
}
