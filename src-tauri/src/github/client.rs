//! Thin reqwest-based GitHub client. Port of `src/lib/github/octokit.ts` +
//! `rate-limit.ts`.
//!
//! `beet_get` is a conditional GET: it sends `If-None-Match` when a cache entry
//! exists, treats `304 Not Modified` as a cache hit (returning the stored body),
//! and otherwise stores the fresh body + ETag. Unlike Octokit, reqwest hands a
//! 304 back as an ordinary response, so there is no error path to special-case.

use crate::error::{BeetError, BeetResult};
use crate::store::etag_cache::{get_cached, set_cached};
use crate::store::Db;
use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE, ETAG, IF_NONE_MATCH, USER_AGENT,
};
use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitInfo {
    pub remaining: i64,
    pub limit: i64,
    pub reset: i64,
}

/// Parse the `x-ratelimit-*` headers. `None` if any are missing/unparseable —
/// mirrors `readRateLimit` in the JS client.
pub fn read_rate_limit(headers: &HeaderMap) -> Option<RateLimitInfo> {
    let get = |name: &str| -> Option<i64> {
        headers.get(name)?.to_str().ok()?.trim().parse::<i64>().ok()
    };
    Some(RateLimitInfo {
        remaining: get("x-ratelimit-remaining")?,
        limit: get("x-ratelimit-limit")?,
        reset: get("x-ratelimit-reset")?,
    })
}

/// Distinguishes a rate-limit 403 (primary bucket exhausted, or secondary
/// abuse limit with a `Retry-After`) from a generic forbidden.
fn is_rate_limited(headers: &HeaderMap) -> bool {
    if headers.get("retry-after").is_some() {
        return true;
    }
    let remaining = headers
        .get("x-ratelimit-remaining")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<i64>().ok());
    matches!(remaining, Some(0))
}

/// Seconds the caller should wait before retrying. Prefers `Retry-After`
/// (GitHub uses a numeric-seconds form, not HTTP-date); falls back to
/// `x-ratelimit-reset` when the bucket is exhausted.
fn retry_after_secs(headers: &HeaderMap) -> Option<u64> {
    if let Some(value) = headers.get("retry-after").and_then(|v| v.to_str().ok()) {
        if let Ok(secs) = value.trim().parse::<u64>() {
            return Some(secs);
        }
    }
    let remaining = headers
        .get("x-ratelimit-remaining")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<i64>().ok())?;
    if remaining > 0 {
        return None;
    }
    let reset = headers
        .get("x-ratelimit-reset")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    Some(reset.saturating_sub(now))
}

#[derive(Debug, Clone)]
pub struct BeetGetResult<T> {
    pub body: T,
    /// `true` when served from the ETag cache (304). Used by shadow-mode
    /// diffing and the Phase 2 frontend wiring.
    #[allow(dead_code)]
    pub from_cache: bool,
    #[allow(dead_code)]
    pub etag: Option<String>,
    pub rate_limit: Option<RateLimitInfo>,
}

const DEFAULT_BASE_URL: &str = "https://api.github.com";

pub struct GithubClient {
    http: reqwest::Client,
    base_url: String,
}

impl GithubClient {
    pub fn new(token: &str) -> BeetResult<Self> {
        Self::with_base_url(token, DEFAULT_BASE_URL)
    }

    /// Construct a client pointed at an arbitrary base URL (used by tests to
    /// target a mock server).
    pub fn with_base_url(token: &str, base_url: &str) -> BeetResult<Self> {
        let mut headers = HeaderMap::new();
        let mut auth = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|e| BeetError::Other(format!("invalid token header: {e}")))?;
        auth.set_sensitive(true);
        headers.insert(AUTHORIZATION, auth);
        headers.insert(
            ACCEPT,
            HeaderValue::from_static("application/vnd.github+json"),
        );
        headers.insert(
            "X-GitHub-Api-Version",
            HeaderValue::from_static("2022-11-28"),
        );
        headers.insert(USER_AGENT, HeaderValue::from_static("beet"));
        let http = reqwest::Client::builder()
            .default_headers(headers)
            .build()?;
        Ok(Self {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
        })
    }

    /// Join an API path (e.g. `/user`, `/repos/o/r/pulls/1`) onto the base URL.
    pub fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    /// Conditional GET with ETag caching. `cache_key` namespaces the cache row;
    /// `url` is the fully-built GitHub API URL (callers do their own templating).
    ///
    /// Transient 5xx and network blips are retried inline with bounded
    /// exponential backoff. 401 / rate-limit / other 4xx propagate as
    /// distinct `BeetError` variants so the caller can react sensibly.
    pub async fn beet_get<T: DeserializeOwned>(
        &self,
        db: &Db,
        cache_key: &str,
        url: &str,
    ) -> BeetResult<BeetGetResult<T>> {
        const MAX_RETRIES: u32 = 2; // total attempts = 3
        const RETRY_BASE_DELAY: std::time::Duration = std::time::Duration::from_millis(250);

        let mut attempt: u32 = 0;
        loop {
            match self.beet_get_once::<T>(db, cache_key, url).await {
                Ok(r) => return Ok(r),
                Err(e) if e.is_transient() && attempt < MAX_RETRIES => {
                    let delay = RETRY_BASE_DELAY * (1u32 << attempt);
                    tokio::time::sleep(delay).await;
                    attempt += 1;
                }
                Err(e) => return Err(e),
            }
        }
    }

    /// One attempt at a conditional GET. The public `beet_get` wraps this with
    /// the retry policy.
    async fn beet_get_once<T: DeserializeOwned>(
        &self,
        db: &Db,
        cache_key: &str,
        url: &str,
    ) -> BeetResult<BeetGetResult<T>> {
        let cached = {
            let conn = db
                .lock()
                .map_err(|e| BeetError::Other(format!("db lock poisoned: {e}")))?;
            get_cached(&conn, cache_key)?
        };

        let mut req = self.http.get(url);
        if let Some(ref entry) = cached {
            req = req.header(IF_NONE_MATCH, entry.etag.as_str());
        }

        let resp = req.send().await?;
        let status = resp.status();
        let headers = resp.headers().clone();
        let rate_limit = read_rate_limit(&headers);

        if status == StatusCode::NOT_MODIFIED {
            let entry = cached.ok_or_else(|| {
                BeetError::Other(format!(
                    "304 Not Modified with no cached body for {cache_key}"
                ))
            })?;
            let body: T = serde_json::from_str(&entry.body_json)?;
            return Ok(BeetGetResult {
                body,
                from_cache: true,
                etag: Some(entry.etag),
                rate_limit,
            });
        }

        // Map non-2xx into specific BeetError variants so callers (and the
        // retry policy) can distinguish "wait it out" from "give up."
        if status == StatusCode::UNAUTHORIZED {
            return Err(BeetError::Unauthorized(status.as_u16()));
        }
        if status == StatusCode::TOO_MANY_REQUESTS
            || (status == StatusCode::FORBIDDEN && is_rate_limited(&headers))
        {
            return Err(BeetError::RateLimited {
                retry_after_secs: retry_after_secs(&headers),
            });
        }
        if status.is_server_error() {
            return Err(BeetError::Transient(status.as_u16()));
        }
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(BeetError::Github {
                status: status.as_u16(),
                body,
            });
        }

        let etag = headers
            .get(ETAG)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let text = resp.text().await?;

        if let Some(ref etag) = etag {
            let conn = db
                .lock()
                .map_err(|e| BeetError::Other(format!("db lock poisoned: {e}")))?;
            set_cached(&conn, cache_key, etag, &text)?;
        }

        let body: T = serde_json::from_str(&text)?;
        Ok(BeetGetResult {
            body,
            from_cache: false,
            etag,
            rate_limit,
        })
    }

    /// POST `{ query, variables }` to GitHub's GraphQL endpoint.
    ///
    /// Used by the auto-requeue worker (#13) — the only mutation Beet issues.
    /// Reuses the same auth and error mapping as `beet_get`, so 401 / 429 /
    /// 5xx propagate as the same `BeetError` variants the poll loop already
    /// handles. A 200 response with a non-empty `errors[]` array is mapped to
    /// `BeetError::Github { status: 200, body }` so the caller can surface the
    /// underlying GraphQL message.
    ///
    /// No retry policy here yet — GraphQL mutations aren't idempotent at the
    /// merge-queue level, and the auto-requeue cap already bounds retries.
    pub async fn beet_post_graphql<TResp: DeserializeOwned>(
        &self,
        query: &str,
        variables: serde_json::Value,
    ) -> BeetResult<TResp> {
        let url = format!("{}/graphql", self.base_url);
        let body = serde_json::json!({ "query": query, "variables": variables });
        let resp = self
            .http
            .post(&url)
            .header(CONTENT_TYPE, "application/json")
            .body(serde_json::to_vec(&body)?)
            .send()
            .await?;

        let status = resp.status();
        let headers = resp.headers().clone();
        if status == StatusCode::UNAUTHORIZED {
            return Err(BeetError::Unauthorized(status.as_u16()));
        }
        if status == StatusCode::TOO_MANY_REQUESTS
            || (status == StatusCode::FORBIDDEN && is_rate_limited(&headers))
        {
            return Err(BeetError::RateLimited {
                retry_after_secs: retry_after_secs(&headers),
            });
        }
        if status.is_server_error() {
            return Err(BeetError::Transient(status.as_u16()));
        }
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(BeetError::Github {
                status: status.as_u16(),
                body: text,
            });
        }

        // GraphQL's "200 + errors[]" pattern: surface the error body so the
        // caller (and the user-facing toast) sees what GitHub actually said.
        let value: serde_json::Value = serde_json::from_str(&text)?;
        if let Some(errors) = value.get("errors").and_then(|v| v.as_array()) {
            if !errors.is_empty() {
                return Err(BeetError::Github {
                    status: 200,
                    body: text,
                });
            }
        }
        let data = value
            .get("data")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let body: TResp = serde_json::from_value(data)?;
        Ok(body)
    }
}

#[cfg(test)]
mod tests {
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
}
