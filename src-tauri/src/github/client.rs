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
#[path = "__tests__/client.rs"]
mod tests;
