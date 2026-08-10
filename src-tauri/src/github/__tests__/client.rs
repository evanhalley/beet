
use super::*;
use crate::store::db::open_in_memory;
use serde::Deserialize;
use std::sync::Mutex;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[derive(Debug, Deserialize, PartialEq, Eq)]
struct Payload {
    value: i64,
}

fn db() -> Db {
    Mutex::new(open_in_memory().unwrap())
}

#[tokio::test]
async fn fetches_and_caches_on_200() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/thing"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("etag", "\"abc\"")
                .insert_header("x-ratelimit-remaining", "4999")
                .insert_header("x-ratelimit-limit", "5000")
                .insert_header("x-ratelimit-reset", "1700000000")
                .set_body_json(serde_json::json!({ "value": 1 })),
        )
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::new("tok").unwrap();
    let url = format!("{}/thing", server.uri());
    let res: BeetGetResult<Payload> = client.beet_get(&db, "thing", &url).await.unwrap();

    assert!(!res.from_cache);
    assert_eq!(res.body, Payload { value: 1 });
    assert_eq!(res.etag.as_deref(), Some("\"abc\""));
    assert_eq!(res.rate_limit.unwrap().remaining, 4999);

    let conn = db.lock().unwrap();
    let cached = get_cached(&conn, "thing").unwrap().unwrap();
    assert_eq!(cached.etag, "\"abc\"");
}

#[tokio::test]
async fn sends_if_none_match_and_returns_cached_body_on_304() {
    let server = MockServer::start().await;
    // First call: 200 populates the cache.
    Mock::given(method("GET"))
        .and(path("/thing"))
        .and(header("if-none-match", "MISSING"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("etag", "\"v1\"")
                .set_body_json(serde_json::json!({ "value": 7 })),
        )
        .up_to_n_times(1)
        .mount(&server)
        .await;
    // Second call carries If-None-Match: "v1" and gets a 304.
    Mock::given(method("GET"))
        .and(path("/thing"))
        .and(header("if-none-match", "\"v1\""))
        .respond_with(ResponseTemplate::new(304))
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::new("tok").unwrap();
    let url = format!("{}/thing", server.uri());

    // Prime: wiremock's first matcher needs *some* if-none-match header to
    // match, so seed the cache with a sentinel via a direct insert instead.
    {
        let conn = db.lock().unwrap();
        set_cached(&conn, "thing", "MISSING", "{\"value\":0}").unwrap();
    }
    let first: BeetGetResult<Payload> = client.beet_get(&db, "thing", &url).await.unwrap();
    assert!(!first.from_cache);
    assert_eq!(first.body, Payload { value: 7 });

    let second: BeetGetResult<Payload> = client.beet_get(&db, "thing", &url).await.unwrap();
    assert!(second.from_cache);
    assert_eq!(second.body, Payload { value: 7 });
}

#[tokio::test]
async fn returns_transient_after_exhausting_5xx_retries() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/boom"))
        .respond_with(ResponseTemplate::new(500).set_body_string("kaboom"))
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::new("tok").unwrap();
    let url = format!("{}/boom", server.uri());
    let err = client
        .beet_get::<Payload>(&db, "boom", &url)
        .await
        .expect_err("persistent 5xx should bubble up");
    assert!(matches!(err, BeetError::Transient(500)));
}

#[tokio::test]
async fn retries_a_5xx_and_succeeds_on_recovery() {
    let server = MockServer::start().await;
    // First two responses fail; wiremock matches mocks in registration
    // order, exhausting the 500 mock before falling through to the 200.
    Mock::given(method("GET"))
        .and(path("/flaky"))
        .respond_with(ResponseTemplate::new(500).set_body_string("oops"))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/flaky"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("etag", "\"recovered\"")
                .set_body_json(serde_json::json!({ "value": 42 })),
        )
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::new("tok").unwrap();
    let url = format!("{}/flaky", server.uri());
    let res: BeetGetResult<Payload> = client.beet_get(&db, "flaky", &url).await.unwrap();
    assert_eq!(res.body, Payload { value: 42 });
    assert_eq!(res.etag.as_deref(), Some("\"recovered\""));
}

#[tokio::test]
async fn maps_401_to_unauthorized() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/auth"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::new("tok").unwrap();
    let url = format!("{}/auth", server.uri());
    let err = client
        .beet_get::<Payload>(&db, "auth", &url)
        .await
        .unwrap_err();
    assert!(matches!(err, BeetError::Unauthorized(401)));
}

#[tokio::test]
async fn maps_429_with_retry_after_to_rate_limited() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/throttled"))
        .respond_with(ResponseTemplate::new(429).insert_header("retry-after", "60"))
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::new("tok").unwrap();
    let url = format!("{}/throttled", server.uri());
    let err = client
        .beet_get::<Payload>(&db, "throttled", &url)
        .await
        .unwrap_err();
    assert!(matches!(
        err,
        BeetError::RateLimited {
            retry_after_secs: Some(60)
        }
    ));
}

#[tokio::test]
async fn maps_403_with_zero_remaining_to_rate_limited() {
    // Primary rate-limit exhaustion comes back as 403 with the bucket at
    // zero; derive retry-after from `x-ratelimit-reset`.
    let reset = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        + 120) as i64;
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/limited"))
        .respond_with(
            ResponseTemplate::new(403)
                .insert_header("x-ratelimit-remaining", "0")
                .insert_header("x-ratelimit-limit", "5000")
                .insert_header("x-ratelimit-reset", reset.to_string()),
        )
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::new("tok").unwrap();
    let url = format!("{}/limited", server.uri());
    let err = client
        .beet_get::<Payload>(&db, "limited", &url)
        .await
        .unwrap_err();
    match err {
        BeetError::RateLimited {
            retry_after_secs: Some(n),
        } => {
            assert!(n > 0 && n <= 120, "expected ~120s, got {n}");
        }
        other => panic!("expected RateLimited, got {other:?}"),
    }
}

#[tokio::test]
async fn beet_post_graphql_returns_data_on_success() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": { "value": 7 }
        })))
        .mount(&server)
        .await;

    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let body: Payload = client
        .beet_post_graphql("mutation { noop }", serde_json::json!({}))
        .await
        .unwrap();
    assert_eq!(body, Payload { value: 7 });
}

#[tokio::test]
async fn beet_post_graphql_treats_200_with_errors_as_github_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": null,
            "errors": [{ "message": "Resource not accessible" }],
        })))
        .mount(&server)
        .await;

    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let err = client
        .beet_post_graphql::<serde_json::Value>("mutation { noop }", serde_json::json!({}))
        .await
        .unwrap_err();
    match err {
        BeetError::Github { status: 200, body } => {
            assert!(body.contains("Resource not accessible"));
        }
        other => panic!("expected Github(200), got {other:?}"),
    }
}

#[tokio::test]
async fn beet_post_graphql_maps_401_to_unauthorized() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;

    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let err = client
        .beet_post_graphql::<serde_json::Value>("mutation { noop }", serde_json::json!({}))
        .await
        .unwrap_err();
    assert!(matches!(err, BeetError::Unauthorized(401)));
}

#[tokio::test]
async fn plain_403_is_not_misclassified_as_rate_limited() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/forbidden"))
        .respond_with(ResponseTemplate::new(403).set_body_string("nope"))
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::new("tok").unwrap();
    let url = format!("{}/forbidden", server.uri());
    let err = client
        .beet_get::<Payload>(&db, "forbidden", &url)
        .await
        .unwrap_err();
    assert!(
        matches!(err, BeetError::Github { status: 403, .. }),
        "expected Github 403, got {err:?}"
    );
}
