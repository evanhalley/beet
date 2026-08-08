
use super::*;
use crate::github::models::{GitRef, UserRef};
use crate::store::db::open_in_memory;
use std::sync::Mutex;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn fetch_review_requests_assembles_and_scores_end_to_end() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/search/issues"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "items": [{
                "number": 1,
                "html_url": "https://github.com/foo/bar/pull/1",
                "url": "https://api.github.com/repos/foo/bar/issues/1",
            }]
        })))
        .mount(&server)
        .await;

    // Recent timestamps — an old PR would trip the stale-score rule.
    let now = chrono::Utc::now().to_rfc3339();
    Mock::given(method("GET"))
        .and(path("/repos/foo/bar/pulls/1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "title": "Add widget",
            "body": null,
            "html_url": "https://github.com/foo/bar/pull/1",
            "state": "open",
            "user": { "login": "octocat" },
            "requested_reviewers": [{ "login": "me" }],
            "head": { "sha": "deadbeef" },
            "additions": 10,
            "deletions": 5,
            "created_at": now,
            "updated_at": now,
        })))
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path("/repos/foo/bar/issues/1/comments"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path("/repos/foo/bar/pulls/1/reviews"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
        .mount(&server)
        .await;

    let db: Db = Mutex::new(open_in_memory().unwrap());
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let opts = FetchReviewRequestsOptions {
        username: "me".to_string(),
        teams: vec![],
        penalized_bots: vec![],
        task_regex: String::new(),
    };

    let outcome = fetch_review_requests(&client, &db, &opts).await.unwrap();
    assert_eq!(outcome.items.len(), 1);
    let item = &outcome.items[0];
    assert_eq!(item.id, "pr:foo/bar#1");
    let pr = item.pr.as_ref().unwrap();
    // is_review_requested_from_me => +3, nothing else => survives filter.
    assert!(pr.is_review_requested_from_me);
    assert_eq!(pr.score, 3);
    assert_eq!(pr.lifecycle, PrLifecycle::InReview);
}

#[tokio::test]
async fn fetch_my_open_prs_detects_merge_queue_ejection() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/search/issues"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "items": [{
                "number": 2,
                "html_url": "https://github.com/foo/bar/pull/2",
                "url": "https://api.github.com/repos/foo/bar/issues/2",
            }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/foo/bar/pulls/2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "title": "My PR",
            "body": null,
            "html_url": "https://github.com/foo/bar/pull/2",
            "state": "open",
            "user": { "login": "me" },
            "head": { "sha": "sha-2" },
            "additions": 1,
            "deletions": 1,
            "created_at": "2026-01-01T00:00:00.000Z",
            "updated_at": "2026-01-02T00:00:00.000Z",
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/foo/bar/issues/2/comments"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/foo/bar/pulls/2/reviews"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/foo/bar/commits/sha-2/check-runs"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "check_runs": [
                { "name": "ci/build", "conclusion": "failure", "html_url": "https://x" },
                { "name": "ci/lint", "conclusion": "success" },
            ]
        })))
        .mount(&server)
        .await;

    let db: Db = Mutex::new(open_in_memory().unwrap());
    // Seed: the PR was previously in the merge queue.
    {
        let conn = db.lock().unwrap();
        record_lifecycle(
            &conn,
            "pr:foo/bar#2",
            PrLifecycle::MergeQueue,
            &PrSnapshot::default(),
        )
        .unwrap();
    }

    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let opts = FetchMyOpenPrsOptions {
        username: "me".to_string(),
        task_regex: String::new(),
        auto_requeue_enabled: false,
        auto_requeue_max_attempts: 2,
        auto_requeue_repos: vec![],
    };
    let outcome = fetch_my_open_prs(&client, &db, &opts).await.unwrap();
    assert_eq!(outcome.items.len(), 1);
    let mq = outcome.items[0]
        .pr
        .as_ref()
        .unwrap()
        .merge_queue
        .as_ref()
        .expect("ejection should produce a mergeQueue with lastEjectionAt");
    assert!(mq.last_ejection_at.is_some());
    let checks = mq.ejected_checks.as_ref().unwrap();
    // Only the failing check is kept.
    assert_eq!(checks.len(), 1);
    assert_eq!(checks[0].name, "ci/build");
}

/// Helper for the auto-requeue worker tests. Seeds the same mocks the
/// detect-ejection test uses, plus a `pulls.get` body that includes
/// `node_id` (needed for the GraphQL mutation) and a `head_sha` of the
/// caller's choice.
async fn seed_my_open_prs_with_ejection(server: &MockServer, head_sha: &str, node_id: &str) {
    Mock::given(method("GET"))
        .and(path("/search/issues"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "items": [{
                "number": 7,
                "html_url": "https://github.com/foo/bar/pull/7",
                "url": "https://api.github.com/repos/foo/bar/issues/7",
            }]
        })))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/foo/bar/pulls/7"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "title": "My PR",
            "body": null,
            "html_url": "https://github.com/foo/bar/pull/7",
            "node_id": node_id,
            "state": "open",
            "user": { "login": "me" },
            "head": { "sha": head_sha },
            "additions": 1,
            "deletions": 1,
            "created_at": "2026-01-01T00:00:00.000Z",
            "updated_at": "2026-01-02T00:00:00.000Z",
        })))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/foo/bar/issues/7/comments"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/foo/bar/pulls/7/reviews"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!(
            "/repos/foo/bar/commits/{head_sha}/check-runs"
        )))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "check_runs": [
                { "name": "ci/build", "conclusion": "failure" },
            ]
        })))
        .mount(server)
        .await;
}

#[tokio::test]
async fn auto_requeue_fires_when_enabled_and_within_cap() {
    let server = MockServer::start().await;
    seed_my_open_prs_with_ejection(&server, "sha-r1", "PR_kwDOA").await;
    // Worker should POST one GraphQL mutation with the node_id.
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": { "enqueuePullRequest": { "mergeQueueEntry": { "position": 4 } } }
        })))
        .expect(1)
        .mount(&server)
        .await;

    let db: Db = Mutex::new(open_in_memory().unwrap());
    {
        let conn = db.lock().unwrap();
        record_lifecycle(
            &conn,
            "pr:foo/bar#7",
            PrLifecycle::MergeQueue,
            &PrSnapshot::default(),
        )
        .unwrap();
    }
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let opts = FetchMyOpenPrsOptions {
        username: "me".to_string(),
        task_regex: String::new(),
        auto_requeue_enabled: true,
        auto_requeue_max_attempts: 2,
        auto_requeue_repos: vec![],
    };
    let outcome = fetch_my_open_prs(&client, &db, &opts).await.unwrap();
    assert!(outcome.auto_requeue_errors.is_empty());
    let conn = db.lock().unwrap();
    assert_eq!(count_attempts(&conn, "pr:foo/bar#7", "sha-r1").unwrap(), 1);
}

#[tokio::test]
async fn auto_requeue_skips_when_disabled() {
    let server = MockServer::start().await;
    seed_my_open_prs_with_ejection(&server, "sha-r2", "PR_kwDOB").await;
    // No /graphql mock — if the worker fires, the call would 404 and the
    // worker would push an entry to auto_requeue_errors.

    let db: Db = Mutex::new(open_in_memory().unwrap());
    {
        let conn = db.lock().unwrap();
        record_lifecycle(
            &conn,
            "pr:foo/bar#7",
            PrLifecycle::MergeQueue,
            &PrSnapshot::default(),
        )
        .unwrap();
    }
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let opts = FetchMyOpenPrsOptions {
        username: "me".to_string(),
        task_regex: String::new(),
        auto_requeue_enabled: false,
        auto_requeue_max_attempts: 2,
        auto_requeue_repos: vec![],
    };
    let outcome = fetch_my_open_prs(&client, &db, &opts).await.unwrap();
    assert!(outcome.auto_requeue_errors.is_empty());
    let conn = db.lock().unwrap();
    assert_eq!(count_attempts(&conn, "pr:foo/bar#7", "sha-r2").unwrap(), 0);
}

#[tokio::test]
async fn auto_requeue_respects_cap_across_cycles() {
    let server = MockServer::start().await;
    seed_my_open_prs_with_ejection(&server, "sha-r3", "PR_kwDOC").await;
    // Worker should only call once even though we run the cycle twice —
    // the second cycle hits the cap (max_attempts = 1).
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": { "enqueuePullRequest": { "mergeQueueEntry": { "position": 1 } } }
        })))
        .expect(1)
        .mount(&server)
        .await;

    let db: Db = Mutex::new(open_in_memory().unwrap());
    {
        let conn = db.lock().unwrap();
        record_lifecycle(
            &conn,
            "pr:foo/bar#7",
            PrLifecycle::MergeQueue,
            &PrSnapshot::default(),
        )
        .unwrap();
    }
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let opts = FetchMyOpenPrsOptions {
        username: "me".to_string(),
        task_regex: String::new(),
        auto_requeue_enabled: true,
        auto_requeue_max_attempts: 1,
        auto_requeue_repos: vec![],
    };
    // Cycle 1 — fires the mutation.
    fetch_my_open_prs(&client, &db, &opts).await.unwrap();
    // Cycle 2 — already at the cap.
    fetch_my_open_prs(&client, &db, &opts).await.unwrap();
    let conn = db.lock().unwrap();
    assert_eq!(count_attempts(&conn, "pr:foo/bar#7", "sha-r3").unwrap(), 1);
}

#[tokio::test]
async fn auto_requeue_respects_opt_out() {
    use crate::store::requeue::set_opt_out;
    let server = MockServer::start().await;
    seed_my_open_prs_with_ejection(&server, "sha-r4", "PR_kwDOD").await;

    let db: Db = Mutex::new(open_in_memory().unwrap());
    {
        let conn = db.lock().unwrap();
        record_lifecycle(
            &conn,
            "pr:foo/bar#7",
            PrLifecycle::MergeQueue,
            &PrSnapshot::default(),
        )
        .unwrap();
        set_opt_out(&conn, "pr:foo/bar#7", "sha-r4", true).unwrap();
    }
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let opts = FetchMyOpenPrsOptions {
        username: "me".to_string(),
        task_regex: String::new(),
        auto_requeue_enabled: true,
        auto_requeue_max_attempts: 2,
        auto_requeue_repos: vec![],
    };
    fetch_my_open_prs(&client, &db, &opts).await.unwrap();
    let conn = db.lock().unwrap();
    assert_eq!(count_attempts(&conn, "pr:foo/bar#7", "sha-r4").unwrap(), 0);
}

#[tokio::test]
async fn auto_requeue_respects_repo_allowlist() {
    let server = MockServer::start().await;
    seed_my_open_prs_with_ejection(&server, "sha-r5", "PR_kwDOE").await;

    let db: Db = Mutex::new(open_in_memory().unwrap());
    {
        let conn = db.lock().unwrap();
        record_lifecycle(
            &conn,
            "pr:foo/bar#7",
            PrLifecycle::MergeQueue,
            &PrSnapshot::default(),
        )
        .unwrap();
    }
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let opts = FetchMyOpenPrsOptions {
        username: "me".to_string(),
        task_regex: String::new(),
        auto_requeue_enabled: true,
        auto_requeue_max_attempts: 2,
        // Allowlist active but doesn't include foo/bar → skip.
        auto_requeue_repos: vec!["other/repo".to_string()],
    };
    fetch_my_open_prs(&client, &db, &opts).await.unwrap();
    let conn = db.lock().unwrap();
    assert_eq!(count_attempts(&conn, "pr:foo/bar#7", "sha-r5").unwrap(), 0);
}

#[tokio::test]
async fn per_pr_rate_limit_propagates_instead_of_silently_dropping() {
    // Regression: when a per-PR detail call hits 429, the old code
    // returned Ok with the PR missing and no rate_limit set. Now the
    // cycle aborts so adaptive backoff + the error UI react.
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/search/issues"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "items": [{
                "number": 9,
                "html_url": "https://github.com/foo/bar/pull/9",
                "url": "https://api.github.com/repos/foo/bar/issues/9",
            }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/foo/bar/pulls/9"))
        .respond_with(ResponseTemplate::new(429).insert_header("retry-after", "45"))
        .mount(&server)
        .await;
    // Comments + reviews respond 200 — only the detail call rate-limits.
    Mock::given(method("GET"))
        .and(path("/repos/foo/bar/issues/9/comments"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/foo/bar/pulls/9/reviews"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
        .mount(&server)
        .await;

    let db: Db = Mutex::new(open_in_memory().unwrap());
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let opts = FetchReviewRequestsOptions {
        username: "me".to_string(),
        teams: vec![],
        penalized_bots: vec![],
        task_regex: String::new(),
    };
    let res = fetch_review_requests(&client, &db, &opts).await;
    assert!(matches!(
        res,
        Err(crate::error::BeetError::RateLimited {
            retry_after_secs: Some(45)
        })
    ));
}

fn pull(state: &str, merged: bool) -> PullDetail {
    PullDetail {
        title: "t".into(),
        body: None,
        html_url: "u".into(),
        node_id: None,
        state: state.into(),
        merged,
        auto_merge: None,
        user: Some(UserRef { login: "a".into() }),
        requested_reviewers: None,
        head: GitRef { sha: "sha".into() },
        draft: false,
        additions: 0,
        deletions: 0,
        created_at: "c".into(),
        updated_at: "u".into(),
    }
}

#[test]
fn parses_repo_and_owner_from_html_and_api_urls() {
    // Primary path: GitHub search hits expose `html_url` first.
    assert_eq!(
        parse_repo_and_owner_from_url("https://github.com/foo/bar/pull/1"),
        Some(("foo".into(), "bar".into()))
    );
    // Fallback `repos/...` regex (used when only the API `url` is present
    // and it does not contain `github.com/`).
    assert_eq!(
        parse_repo_and_owner_from_url("repos/foo/bar/pulls/1"),
        Some(("foo".into(), "bar".into()))
    );
    assert_eq!(parse_repo_and_owner_from_url("not a url"), None);
}

#[test]
fn derive_lifecycle_covers_all_states() {
    assert_eq!(derive_lifecycle(&pull("closed", true)), PrLifecycle::Merged);
    assert_eq!(
        derive_lifecycle(&pull("closed", false)),
        PrLifecycle::Closed
    );

    let mut p = pull("open", false);
    p.auto_merge = Some(serde_json::json!({ "enabled_by": {} }));
    assert_eq!(derive_lifecycle(&p), PrLifecycle::MergeQueue);

    let mut p = pull("open", false);
    p.auto_merge = Some(serde_json::Value::Null);
    p.requested_reviewers = Some(vec![UserRef { login: "r".into() }]);
    assert_eq!(derive_lifecycle(&p), PrLifecycle::InReview);

    assert_eq!(derive_lifecycle(&pull("open", false)), PrLifecycle::Open);
}

#[test]
fn build_reviewers_collapses_to_latest_per_login() {
    // alice: approved -> changes_requested -> approved (final approved).
    // bob: approved then PENDING (PENDING is ignored, bob stays approved).
    // carol: commented only.
    let reviews = vec![
        ReviewRow {
            user: Some(UserRef {
                login: "alice".into(),
            }),
            state: "APPROVED".into(),
        },
        ReviewRow {
            user: Some(UserRef {
                login: "alice".into(),
            }),
            state: "CHANGES_REQUESTED".into(),
        },
        ReviewRow {
            user: Some(UserRef {
                login: "alice".into(),
            }),
            state: "APPROVED".into(),
        },
        ReviewRow {
            user: Some(UserRef {
                login: "bob".into(),
            }),
            state: "APPROVED".into(),
        },
        ReviewRow {
            user: Some(UserRef {
                login: "bob".into(),
            }),
            state: "PENDING".into(),
        },
        ReviewRow {
            user: Some(UserRef {
                login: "carol".into(),
            }),
            state: "COMMENTED".into(),
        },
    ];
    let out = build_reviewers(&reviews, None);
    assert_eq!(out.len(), 3);
    // Output is alphabetical by login.
    assert_eq!(out[0].login, "alice");
    assert_eq!(out[0].state, "approved");
    assert_eq!(out[1].login, "bob");
    assert_eq!(out[1].state, "approved");
    assert_eq!(out[2].login, "carol");
    assert_eq!(out[2].state, "commented");
}

#[test]
fn build_reviewers_includes_requested_with_no_submitted_review() {
    let reviews = vec![ReviewRow {
        user: Some(UserRef {
            login: "alice".into(),
        }),
        state: "APPROVED".into(),
    }];
    // bob was requested but hasn't reviewed yet → appears with state
    // "requested". alice already submitted → no duplicate row for her.
    let requested = vec![
        UserRef {
            login: "alice".into(),
        },
        UserRef {
            login: "bob".into(),
        },
    ];
    let out = build_reviewers(&reviews, Some(&requested));
    assert_eq!(out.len(), 2);
    assert_eq!(out[0].login, "alice");
    assert_eq!(out[0].state, "approved");
    assert_eq!(out[1].login, "bob");
    assert_eq!(out[1].state, "requested");
}

#[tokio::test]
async fn assemble_my_pr_item_attaches_full_check_runs() {
    // Same fixture shape as `fetch_my_open_prs_detects_merge_queue_ejection`
    // but checks span success + failure + in_progress to assert the full
    // list (not just failing) reaches the row.
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/search/issues"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "items": [{
                "number": 11,
                "html_url": "https://github.com/foo/bar/pull/11",
                "url": "https://api.github.com/repos/foo/bar/issues/11",
            }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/foo/bar/pulls/11"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "title": "My PR",
            "body": null,
            "html_url": "https://github.com/foo/bar/pull/11",
            "state": "open",
            "user": { "login": "me" },
            "head": { "sha": "sha-c" },
            "additions": 1,
            "deletions": 1,
            "created_at": "2026-01-01T00:00:00.000Z",
            "updated_at": "2026-01-02T00:00:00.000Z",
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/foo/bar/issues/11/comments"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/foo/bar/pulls/11/reviews"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/foo/bar/commits/sha-c/check-runs"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "check_runs": [
                { "name": "build", "status": "completed", "conclusion": "success" },
                { "name": "integration", "status": "completed", "conclusion": "failure" },
                { "name": "deploy", "status": "in_progress", "conclusion": null },
            ]
        })))
        .mount(&server)
        .await;

    let db: Db = Mutex::new(open_in_memory().unwrap());
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let opts = FetchMyOpenPrsOptions {
        username: "me".to_string(),
        task_regex: String::new(),
        auto_requeue_enabled: false,
        auto_requeue_max_attempts: 2,
        auto_requeue_repos: vec![],
    };
    let outcome = fetch_my_open_prs(&client, &db, &opts).await.unwrap();
    let pr = outcome.items[0].pr.as_ref().unwrap();
    let runs = pr
        .check_runs
        .as_ref()
        .expect("check_runs should be populated");
    assert_eq!(runs.len(), 3);
    assert_eq!(runs[0].name, "build");
    assert_eq!(runs[0].conclusion.as_deref(), Some("success"));
    assert_eq!(runs[2].status.as_deref(), Some("in_progress"));
}

#[test]
fn count_distinct_approvers_uses_latest_state_per_user() {
    let rows = |pairs: &[(&str, &str)]| {
        pairs
            .iter()
            .map(|(login, state)| ReviewRow {
                user: Some(UserRef {
                    login: login.to_string(),
                }),
                state: state.to_string(),
            })
            .collect::<Vec<_>>()
    };
    // alice: APPROVED -> CHANGES_REQUESTED -> APPROVED (counts)
    // bob: APPROVED then PENDING (PENDING ignored, still counts)
    // carol: COMMENTED (does not count)
    let reviews = rows(&[
        ("alice", "APPROVED"),
        ("alice", "CHANGES_REQUESTED"),
        ("alice", "APPROVED"),
        ("bob", "APPROVED"),
        ("bob", "PENDING"),
        ("carol", "COMMENTED"),
    ]);
    assert_eq!(count_distinct_approvers(&reviews), 2);
}
