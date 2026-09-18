use super::*;
use crate::github::codeowners::parse_codeowners;
use crate::store::db::open_in_memory;
use base64::Engine;
use std::collections::HashSet;
use std::sync::Mutex;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn db() -> Db {
    Mutex::new(open_in_memory().unwrap())
}

fn file_rows(n: usize, prefix: &str) -> serde_json::Value {
    serde_json::Value::Array(
        (0..n)
            .map(|i| {
                serde_json::json!({
                    "filename": format!("{prefix}{i}.rs"),
                    "status": "modified",
                    "additions": 1,
                    "deletions": 0,
                    "patch": "@@ -1 +1 @@\n-a\n+b",
                })
            })
            .collect(),
    )
}

fn row(name: &str, status: &str, prev: Option<&str>) -> PullFileRow {
    PullFileRow {
        filename: name.into(),
        status: status.into(),
        additions: 3,
        deletions: 1,
        previous_filename: prev.map(|p| p.into()),
    }
}

fn sample_files() -> Vec<PullFileRow> {
    vec![
        row("src/lib/a.rs", "modified", None),
        row("README.md", "added", None),
        row("docs/x.md", "renamed", Some("docs/y.md")),
        row("vendor/z.js", "removed", None),
    ]
}

fn sample_codeowners() -> Codeowners {
    Codeowners {
        path: ".github/CODEOWNERS".into(),
        rules: parse_codeowners("/src/ @acme/core\n*.md @evan\n/vendor/\n"),
    }
}

fn teams(resolved: bool, list: &[&str]) -> UserTeams {
    UserTeams {
        teams: list.iter().map(|s| s.to_string()).collect::<HashSet<_>>(),
        resolved,
    }
}

// ---------- diff_anchor ----------

#[test]
fn diff_anchor_is_sha256_of_the_path() {
    assert_eq!(
        diff_anchor("README.md"),
        "diff-b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5"
    );
    assert_eq!(
        diff_anchor("src/lib/a.rs"),
        "diff-0618dc18b590ff5e851c03e6a8caf8c373bbe1e07376488840a15f89255482e3"
    );
}

// ---------- fetch_changed_files ----------

#[tokio::test]
async fn changed_files_paginates_until_a_short_page() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/pulls/7/files"))
        .and(query_param("per_page", "100"))
        .and(query_param("page", "1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(file_rows(100, "a")))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/pulls/7/files"))
        .and(query_param("page", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(file_rows(3, "b")))
        .expect(1)
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let (files, truncated) = fetch_changed_files(&client, &db, "o", "r", 7, "head1")
        .await
        .unwrap();
    assert_eq!(files.len(), 103);
    assert!(!truncated);
    assert_eq!(files[102].filename, "b2.rs");
}

#[tokio::test]
async fn changed_files_stops_at_the_github_cap_and_flags_truncation() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/pulls/7/files"))
        .respond_with(ResponseTemplate::new(200).set_body_json(file_rows(100, "a")))
        .expect(30)
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let (files, truncated) = fetch_changed_files(&client, &db, "o", "r", 7, "head1")
        .await
        .unwrap();
    assert_eq!(files.len(), MAX_FILES);
    assert!(truncated);
}

#[tokio::test]
async fn changed_files_propagates_rate_limit() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(429).insert_header("retry-after", "9"))
        .mount(&server)
        .await;
    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let res = fetch_changed_files(&client, &db, "o", "r", 7, "head1").await;
    assert!(matches!(
        res,
        Err(crate::error::BeetError::RateLimited {
            retry_after_secs: Some(9)
        })
    ));
}

// ---------- assemble ----------

#[test]
fn assemble_marks_team_and_individual_ownership() {
    let co = sample_codeowners();
    let r = assemble(
        sample_files(),
        false,
        Some(&co),
        "Evan",
        &teams(true, &["acme/core"]),
    );

    assert!(r.has_codeowners);
    assert_eq!(r.codeowners_path.as_deref(), Some(".github/CODEOWNERS"));
    assert!(r.teams_resolved);
    assert_eq!(r.total_count, 4);
    assert_eq!(r.owned_count, 3);
    assert!(!r.truncated);
    assert_eq!(r.username, "Evan");

    let by_path = |p: &str| r.files.iter().find(|f| f.path == p).unwrap();
    let a = by_path("src/lib/a.rs");
    assert!(a.owned_by_me);
    assert_eq!(a.owners, vec!["@acme/core".to_string()]);
    assert_eq!(a.status, "modified");
    assert_eq!((a.additions, a.deletions), (3, 1));
    assert_eq!(a.anchor, diff_anchor("src/lib/a.rs"));
    assert_eq!(a.previous_path, None);

    let readme = by_path("README.md");
    assert!(readme.owned_by_me);
    assert_eq!(readme.owners, vec!["@evan".to_string()]);

    let renamed = by_path("docs/x.md");
    assert!(renamed.owned_by_me);
    assert_eq!(renamed.previous_path.as_deref(), Some("docs/y.md"));

    let vendor = by_path("vendor/z.js");
    assert!(!vendor.owned_by_me);
    assert!(vendor.owners.is_empty());
}

#[test]
fn assemble_preserves_file_order() {
    let co = sample_codeowners();
    let r = assemble(sample_files(), true, Some(&co), "evan", &teams(true, &[]));
    let paths: Vec<&str> = r.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(
        paths,
        vec!["src/lib/a.rs", "README.md", "docs/x.md", "vendor/z.js"]
    );
    assert!(r.truncated);
}

#[test]
fn assemble_without_team_resolution_counts_individual_rules_only() {
    let co = sample_codeowners();
    let r = assemble(sample_files(), false, Some(&co), "evan", &teams(false, &[]));
    assert!(!r.teams_resolved);
    assert_eq!(r.owned_count, 2);
    assert!(
        !r.files
            .iter()
            .find(|f| f.path == "src/lib/a.rs")
            .unwrap()
            .owned_by_me
    );
    // Owners are still reported so the UI can show who does own it.
    assert_eq!(
        r.files
            .iter()
            .find(|f| f.path == "src/lib/a.rs")
            .unwrap()
            .owners,
        vec!["@acme/core".to_string()]
    );
}

#[test]
fn assemble_without_codeowners_owns_nothing() {
    let r = assemble(
        sample_files(),
        false,
        None,
        "evan",
        &teams(true, &["acme/core"]),
    );
    assert!(!r.has_codeowners);
    assert_eq!(r.codeowners_path, None);
    assert_eq!(r.owned_count, 0);
    assert_eq!(r.total_count, 4);
    assert!(r
        .files
        .iter()
        .all(|f| !f.owned_by_me && f.owners.is_empty()));
}

#[test]
fn code_ownership_summary_mirrors_the_result() {
    let co = sample_codeowners();
    let r = assemble(sample_files(), false, Some(&co), "evan", &teams(false, &[]));
    let summary = CodeOwnership::from(&r);
    assert_eq!(
        summary,
        CodeOwnership {
            owned_count: 2,
            total_count: 4,
            has_codeowners: true,
            teams_resolved: false,
        }
    );
}

// ---------- fetch_pr_files ----------

fn b64(text: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(text)
}

async fn mount_happy_path(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path("/repos/o/r/pulls/7"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "title": "t", "html_url": "https://github.com/o/r/pull/7", "state": "open",
            "user": { "login": "alice" },
            "head": { "sha": "head1", "ref": "feat" },
            "base": { "sha": "base1", "ref": "main" },
            "additions": 1, "deletions": 1,
            "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-02T00:00:00Z",
        })))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/pulls/7/files"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            { "filename": "src/a.rs", "status": "modified", "additions": 1, "deletions": 0 },
            { "filename": "README.md", "status": "modified", "additions": 1, "deletions": 0 },
        ])))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/contents/.github/CODEOWNERS"))
        .and(query_param("ref", "main"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "content": b64("/src/ @acme/core\n"), "encoding": "base64", "sha": "x",
        })))
        .expect(1)
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path("/user/teams"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            { "slug": "core", "organization": { "login": "acme" } }
        ])))
        .expect(1)
        .mount(server)
        .await;
}

#[tokio::test]
async fn fetch_pr_files_fills_missing_refs_from_pull_detail_and_uses_session_cache() {
    let server = MockServer::start().await;
    mount_happy_path(&server).await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let cache = SessionCache::default();
    let pr = PrRef {
        owner: "o".into(),
        repo: "r".into(),
        number: 7,
        head_sha: None,
        base_ref: None,
        base_sha: None,
    };

    let first = fetch_pr_files(&client, &db, &cache, pr.clone(), "evan")
        .await
        .unwrap();
    assert_eq!(first.owned_count, 1);
    assert_eq!(first.total_count, 2);
    assert!(first.has_codeowners);
    assert!(first.teams_resolved);
    assert!(first.files[0].owned_by_me);
    assert!(!first.files[1].owned_by_me);

    // Second call: CODEOWNERS and /user/teams come from the session cache
    // (their mocks expect exactly one hit).
    let second = fetch_pr_files(&client, &db, &cache, pr, "evan")
        .await
        .unwrap();
    assert_eq!(first, second);
}

#[tokio::test]
async fn fetch_pr_files_skips_pull_detail_when_refs_are_known() {
    let server = MockServer::start().await;
    mount_happy_path(&server).await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/pulls/7"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let cache = SessionCache::default();
    let pr = PrRef {
        owner: "o".into(),
        repo: "r".into(),
        number: 7,
        head_sha: Some("head1".into()),
        base_ref: Some("main".into()),
        base_sha: Some("base1".into()),
    };
    let r = fetch_pr_files(&client, &db, &cache, pr, "evan")
        .await
        .unwrap();
    assert_eq!(r.owned_count, 1);
}

#[tokio::test]
async fn missing_base_skips_codeowners_instead_of_reading_the_head_branch() {
    // Guessing the head branch would read the PR's own (author-controlled)
    // CODEOWNERS, or 404 for forks. With no base, ownership is unknown.
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/pulls/7"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "title": "t", "html_url": "https://github.com/o/r/pull/7", "state": "open",
            "user": { "login": "alice" },
            "head": { "sha": "head1", "ref": "feat" },
            "additions": 1, "deletions": 1,
            "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-02T00:00:00Z",
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/pulls/7/files"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            { "filename": "src/a.rs", "status": "modified" },
        ])))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path_regex_contents())
        .respond_with(ResponseTemplate::new(200))
        .expect(0)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/user/teams"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let cache = SessionCache::default();
    let pr = PrRef {
        owner: "o".into(),
        repo: "r".into(),
        number: 7,
        head_sha: None,
        base_ref: None,
        base_sha: None,
    };
    let r = fetch_pr_files(&client, &db, &cache, pr, "evan")
        .await
        .unwrap();
    assert!(!r.has_codeowners);
    assert_eq!(r.total_count, 1);
    assert_eq!(r.owned_count, 0);
}

fn path_regex_contents() -> wiremock::matchers::PathRegexMatcher {
    wiremock::matchers::path_regex(r"^/repos/o/r/contents/")
}
