
use super::*;
use crate::store::db::open_in_memory;
use std::sync::Mutex;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn resolves_members_and_skips_failures() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/orgs/acme/teams/core/members"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("etag", "\"t1\"")
                .set_body_json(serde_json::json!([
                    { "login": "alice" },
                    { "login": "bob" },
                ])),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/orgs/acme/teams/missing/members"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;

    let db: Db = Mutex::new(open_in_memory().unwrap());
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let members = resolve_team_members(
        &client,
        &db,
        &[
            "acme/core".to_string(),
            "acme/missing".to_string(),
            "malformed".to_string(),
        ],
    )
    .await
    .unwrap();

    assert!(members.contains("alice"));
    assert!(members.contains("bob"));
    assert_eq!(members.len(), 2);
}

#[tokio::test]
async fn empty_team_list_resolves_to_empty_set() {
    let db: Db = Mutex::new(open_in_memory().unwrap());
    let client = GithubClient::new("tok").unwrap();
    let members = resolve_team_members(&client, &db, &[]).await.unwrap();
    assert!(members.is_empty());
}

#[tokio::test]
async fn propagates_rate_limit_from_team_endpoint() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/orgs/acme/teams/core/members"))
        .respond_with(ResponseTemplate::new(429).insert_header("retry-after", "30"))
        .mount(&server)
        .await;

    let db: Db = Mutex::new(open_in_memory().unwrap());
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let res = resolve_team_members(&client, &db, &["acme/core".to_string()]).await;
    assert!(matches!(
        res,
        Err(crate::error::BeetError::RateLimited {
            retry_after_secs: Some(30)
        })
    ));
}
