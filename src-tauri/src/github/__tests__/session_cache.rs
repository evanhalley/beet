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

// ---------- review follow-ups ----------

#[tokio::test]
async fn cache_remembers_unreadable_codeowners() {
    // Fine-grained PAT without Contents:read answers 403. That's definitive
    // for the session, so it must not be re-asked every poll.
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/contents/.github/CODEOWNERS"))
        .respond_with(ResponseTemplate::new(403).set_body_string("Resource not accessible"))
        .expect(1)
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
}

#[tokio::test]
async fn slow_codeowners_for_one_repo_does_not_block_another() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/slow/r/contents/.github/CODEOWNERS"))
        .respond_with(contents_ok("* @a\n").set_delay(std::time::Duration::from_millis(600)))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/fast/r/contents/.github/CODEOWNERS"))
        .respond_with(contents_ok("* @b\n"))
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let cache = SessionCache::default();
    let started = tokio::time::Instant::now();
    let slow = cache.codeowners(&client, &db, "slow", "r", "main", "s1");
    let fast = async {
        // Let the slow lookup take whatever lock it takes first.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let r = cache
            .codeowners(&client, &db, "fast", "r", "main", "s2")
            .await;
        (r, started.elapsed())
    };
    let (slow_res, (fast_res, fast_elapsed)) = tokio::join!(slow, fast);
    assert!(slow_res.unwrap().is_some());
    assert!(fast_res.unwrap().is_some());
    assert!(
        fast_elapsed < std::time::Duration::from_millis(400),
        "fast repo waited {fast_elapsed:?} behind the slow one"
    );
}

#[tokio::test]
async fn clear_during_an_in_flight_teams_fetch_discards_its_result() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/user/teams"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(team_rows(1, "old", "team"))
                .set_delay(std::time::Duration::from_millis(300)),
        )
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/user/teams"))
        .respond_with(ResponseTemplate::new(200).set_body_json(team_rows(1, "new", "team")))
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let cache = SessionCache::default();
    let in_flight = cache.user_teams(&client, &db);
    let rotate = async {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        cache.clear();
    };
    let (stale, ()) = tokio::join!(in_flight, rotate);
    // The caller that started before the rotation still gets its answer...
    assert!(stale.unwrap().teams.contains("old/team0"));
    // ...but it must not be what the next session sees.
    let fresh = cache.user_teams(&client, &db).await.unwrap();
    assert!(fresh.teams.contains("new/team0"), "got {:?}", fresh.teams);
}

#[tokio::test]
async fn clear_during_an_in_flight_codeowners_fetch_discards_its_result() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/contents/.github/CODEOWNERS"))
        .respond_with(contents_ok("* @old\n").set_delay(std::time::Duration::from_millis(300)))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/contents/.github/CODEOWNERS"))
        .respond_with(contents_ok("* @new\n"))
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let cache = SessionCache::default();
    let in_flight = cache.codeowners(&client, &db, "o", "r", "main", "sha1");
    let rotate = async {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        cache.clear();
    };
    let (_stale, ()) = tokio::join!(in_flight, rotate);
    let fresh = cache
        .codeowners(&client, &db, "o", "r", "main", "sha1")
        .await
        .unwrap();
    let rules = &fresh.as_ref().as_ref().unwrap().rules;
    assert_eq!(rules[0].owners, vec!["@new".to_string()]);
}
