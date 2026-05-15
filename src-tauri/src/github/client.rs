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
    HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, ETAG, IF_NONE_MATCH, USER_AGENT,
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
    pub async fn beet_get<T: DeserializeOwned>(
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
                BeetError::Other(format!("304 Not Modified with no cached body for {cache_key}"))
            })?;
            let body: T = serde_json::from_str(&entry.body_json)?;
            return Ok(BeetGetResult {
                body,
                from_cache: true,
                etag: Some(entry.etag),
                rate_limit,
            });
        }

        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(BeetError::Other(format!(
                "GitHub request failed ({status}) for {url}: {body}"
            )));
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
        let res: BeetGetResult<Payload> =
            client.beet_get(&db, "thing", &url).await.unwrap();

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
        let first: BeetGetResult<Payload> =
            client.beet_get(&db, "thing", &url).await.unwrap();
        assert!(!first.from_cache);
        assert_eq!(first.body, Payload { value: 7 });

        let second: BeetGetResult<Payload> =
            client.beet_get(&db, "thing", &url).await.unwrap();
        assert!(second.from_cache);
        assert_eq!(second.body, Payload { value: 7 });
    }

    #[tokio::test]
    async fn errors_on_non_success_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/boom"))
            .respond_with(ResponseTemplate::new(500).set_body_string("kaboom"))
            .mount(&server)
            .await;

        let db = db();
        let client = GithubClient::new("tok").unwrap();
        let url = format!("{}/boom", server.uri());
        let res: BeetResult<BeetGetResult<Payload>> =
            client.beet_get(&db, "boom", &url).await;
        assert!(res.is_err());
    }
}
