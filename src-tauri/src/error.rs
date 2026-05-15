//! Unified error type for the Rust poll pipeline. Phase 4 expands this into a
//! richer taxonomy (transient vs. fatal, rate-limit, etc.); for now it is a
//! thin wrapper that lets the store / github / poller layers share one `Result`.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum BeetError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Other(String),
}

pub type BeetResult<T> = Result<T, BeetError>;
