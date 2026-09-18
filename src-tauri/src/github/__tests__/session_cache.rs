use super::*;
use crate::error::BeetError;
use crate::github::codeowners::owners_for;
use crate::store::db::open_in_memory;
use base64::Engine;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn db() -> Db {
    Mutex::new(open_in_memory().unwrap())
}

fn team_rows(n: usize, org: &str, prefix: &str) -> serde_json::Value {
    serde_json::Value::Array(
        (0..n)
            .map(|i| serde_json::json!({ "slug": format!("{prefix}{i}"), "organization": { "login": org } }))
            .collect(),
    )
}

fn b64_with_newlines(text: &str) -> String {
    let raw = base64::engine::general_purpose::STANDARD.encode(text);
    raw.as_bytes()
        .chunks(20)
        .map(|c| std::str::from_utf8(c).unwrap())
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

fn contents_ok(text: &str) -> ResponseTemplate {
    ResponseTemplate::new(200)
        .insert_header("etag", "\"c1\"")
        .set_body_json(serde_json::json!({
            "content": b64_with_newlines(text),
            "encoding": "base64",
            "sha": "abc",
        }))
}

// ---------- fetch_user_teams ----------

#[tokio::test]
async fn user_teams_paginates_and_lowercases_org_slug() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/user/teams"))
        .and(query_param("page", "1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(team_rows(100, "Acme", "Team-")))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/user/teams"))
        .and(query_param("page", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(team_rows(2, "Other", "x")))
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let teams = fetch_user_teams(&client, &db).await.unwrap();

    assert!(teams.resolved);
    assert_eq!(teams.teams.len(), 102);
    assert!(teams.teams.contains("acme/team-0"));
    assert!(teams.teams.contains("acme/team-99"));
    assert!(teams.teams.contains("other/x1"));
}

#[tokio::test]
async fn user_teams_forbidden_means_unresolved_not_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/user/teams"))
        .respond_with(ResponseTemplate::new(403).set_body_string("scope"))
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let teams = fetch_user_teams(&client, &db).await.unwrap();
    assert_eq!(
        teams,
        UserTeams {
            teams: HashSet::new(),
            resolved: false
        }
    );
}

#[tokio::test]
async fn user_teams_rate_limit_propagates() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/user/teams"))
        .respond_with(ResponseTemplate::new(429).insert_header("retry-after", "30"))
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let res = fetch_user_teams(&client, &db).await;
    assert!(matches!(
        res,
        Err(BeetError::RateLimited {
            retry_after_secs: Some(30)
        })
    ));
}

// ---------- SessionCache::user_teams ----------

#[tokio::test]
async fn cache_fetches_user_teams_once_per_session() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/user/teams"))
        .respond_with(ResponseTemplate::new(200).set_body_json(team_rows(1, "acme", "core")))
        .expect(1)
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let cache = SessionCache::default();
    let a = cache.user_teams(&client, &db).await.unwrap();
    let b = cache.user_teams(&client, &db).await.unwrap();
    assert_eq!(a, b);
    assert!(a.teams.contains("acme/core0"));
}

#[tokio::test]
async fn cache_remembers_forbidden_and_clear_refetches() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/user/teams"))
        .respond_with(ResponseTemplate::new(403))
        .expect(2)
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let cache = SessionCache::default();
    assert!(!cache.user_teams(&client, &db).await.unwrap().resolved);
    assert!(!cache.user_teams(&client, &db).await.unwrap().resolved);
    cache.clear();
    assert!(!cache.user_teams(&client, &db).await.unwrap().resolved);
}

#[tokio::test]
async fn cache_does_not_remember_rate_limit() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/user/teams"))
        .respond_with(ResponseTemplate::new(429).insert_header("retry-after", "1"))
        .expect(2)
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let cache = SessionCache::default();
    assert!(cache.user_teams(&client, &db).await.is_err());
    assert!(cache.user_teams(&client, &db).await.is_err());
}

// ---------- fetch_codeowners ----------

#[tokio::test]
async fn codeowners_falls_back_through_locations_in_order() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/contents/.github/CODEOWNERS"))
        .and(query_param("ref", "main"))
        .respond_with(ResponseTemplate::new(404))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/contents/CODEOWNERS"))
        .and(query_param("ref", "main"))
        .respond_with(contents_ok("# owners\n/src/ @acme/core\n*.md @evan\n"))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/contents/docs/CODEOWNERS"))
        .respond_with(ResponseTemplate::new(200))
        .expect(0)
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let co = fetch_codeowners(&client, &db, "o", "r", "main")
        .await
        .unwrap()
        .expect("found");
    assert_eq!(co.path, "CODEOWNERS");
    assert_eq!(co.rules.len(), 2);
    assert_eq!(
        owners_for(&co.rules, "src/a.rs").map(|o| o.to_vec()),
        Some(vec!["@acme/core".to_string()])
    );
}

#[tokio::test]
async fn codeowners_all_missing_is_none() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(404))
        .expect(3)
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let co = fetch_codeowners(&client, &db, "o", "r", "main")
        .await
        .unwrap();
    assert!(co.is_none());
}

#[tokio::test]
async fn codeowners_rate_limit_propagates() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(429).insert_header("retry-after", "5"))
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let res = fetch_codeowners(&client, &db, "o", "r", "main").await;
    assert!(matches!(res, Err(BeetError::RateLimited { .. })));
}

// ---------- SessionCache::codeowners ----------

#[tokio::test]
async fn cache_remembers_missing_codeowners_per_base_sha() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(404))
        .expect(6) // 3 locations × 2 distinct base shas
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let cache = SessionCache::default();
    for _ in 0..3 {
        let co = cache
            .codeowners(&client, &db, "o", "r", "main", "sha1")
            .await
            .unwrap();
        assert!(co.is_none());
    }
    let co = cache
        .codeowners(&client, &db, "o", "r", "main", "sha2")
        .await
        .unwrap();
    assert!(co.is_none());
}

#[tokio::test]
async fn cache_returns_parsed_codeowners_and_clear_refetches() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/contents/.github/CODEOWNERS"))
        .respond_with(contents_ok("* @evan\n"))
        .expect(2)
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let cache = SessionCache::default();
    let a = cache
        .codeowners(&client, &db, "o", "r", "main", "sha1")
        .await
        .unwrap();
    let b = cache
        .codeowners(&client, &db, "o", "r", "main", "sha1")
        .await
        .unwrap();
    assert!(Arc::ptr_eq(&a, &b));
    assert_eq!(a.as_ref().as_ref().unwrap().path, ".github/CODEOWNERS");
    cache.clear();
    let c = cache
        .codeowners(&client, &db, "o", "r", "main", "sha1")
        .await
        .unwrap();
    assert!(!Arc::ptr_eq(&a, &c));
}
