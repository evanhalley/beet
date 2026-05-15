//! Unified error type for the Rust poll pipeline.
//!
//! Variants exist for the kinds of failure callers need to *distinguish* — not
//! every wire format. `is_transient()` is the contract the retry loop in
//! `beet_get` relies on; if you add a variant whose meaning is "try again in a
//! moment," update that predicate too.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum BeetError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    /// No GitHub PAT is configured in the keychain.
    #[error("No GitHub token configured")]
    NoToken,

    /// GitHub returned 401 — the PAT is missing, expired, or revoked. Not
    /// retryable; the user must re-enter a token.
    #[error("GitHub auth failed (HTTP {0})")]
    Unauthorized(u16),

    /// Primary or secondary rate limit. `retry_after_secs` is from the
    /// `Retry-After` header or computed from `x-ratelimit-reset`; `None` means
    /// GitHub didn't tell us. Phase 5 will use this to stretch the poll
    /// interval; Phase 4 just surfaces it.
    #[error("GitHub rate limited (retry after {retry_after_secs:?}s)")]
    RateLimited { retry_after_secs: Option<u64> },

    /// 5xx server error — worth retrying within the same poll cycle.
    #[error("GitHub server error (HTTP {0})")]
    Transient(u16),

    /// Non-2xx that doesn't fit a more specific category above.
    #[error("GitHub request failed (HTTP {status}): {body}")]
    Github { status: u16, body: String },

    #[error("{0}")]
    Other(String),
}

impl BeetError {
    /// A fresh attempt has a plausible chance of succeeding *right now* —
    /// transient 5xx or a low-level network blip. Rate-limit and auth errors
    /// are intentionally NOT transient: those need a wait or a new token, not
    /// inline retries.
    pub fn is_transient(&self) -> bool {
        match self {
            BeetError::Transient(_) => true,
            BeetError::Http(e) => e.is_timeout() || e.is_connect(),
            _ => false,
        }
    }
}

pub type BeetResult<T> = Result<T, BeetError>;
