//! Poll configuration: the subset of Beet settings the Rust poll loop needs.
//! Loaded from tauri-plugin-store (`config.json`) — the same store the
//! Settings UI writes. Keys and defaults mirror `src/lib/storage/settings.ts`.

use crate::tasks::DEFAULT_TASK_REGEX;
use serde_json::Value;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "config.json";

const POLLING_INTERVAL_MIN: u64 = 15;
const POLLING_INTERVAL_MAX: u64 = 600;
const POLLING_INTERVAL_DEFAULT: u64 = 60;

const AUTO_REQUEUE_MAX_ATTEMPTS_MIN: u32 = 1;
const AUTO_REQUEUE_MAX_ATTEMPTS_MAX: u32 = 5;
const AUTO_REQUEUE_MAX_ATTEMPTS_DEFAULT: u32 = 2;

/// The slice of Beet settings the poll loop needs. `showAllApproved` is *not*
/// here: it only affects which already-scored items are shown, which the
/// frontend now decides — Rust always returns the full scored list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PollConfig {
    pub teams: Vec<String>,
    pub penalized_bots: Vec<String>,
    pub task_regex: String,
    /// Already clamped to `[15, 600]`.
    pub polling_interval_sec: u64,
    /// Master switch for the merge-queue auto-requeue worker (#13). Off by
    /// default — the user must opt in via Settings → Merge Queue.
    pub auto_requeue_enabled: bool,
    /// Maximum auto-requeue attempts per `(pr_id, head_sha)`. Already clamped
    /// to `[1, 5]`. Default 2 — a flake usually clears in one retry.
    pub auto_requeue_max_attempts: u32,
    /// Optional allowlist of `owner/repo` strings. Empty = all repos.
    pub auto_requeue_repos: Vec<String>,
}

impl Default for PollConfig {
    fn default() -> Self {
        Self {
            teams: Vec::new(),
            penalized_bots: Vec::new(),
            task_regex: DEFAULT_TASK_REGEX.to_string(),
            polling_interval_sec: POLLING_INTERVAL_DEFAULT,
            auto_requeue_enabled: false,
            auto_requeue_max_attempts: AUTO_REQUEUE_MAX_ATTEMPTS_DEFAULT,
            auto_requeue_repos: Vec::new(),
        }
    }
}

impl PollConfig {
    /// Read the config from `config.json`. Any missing/unreadable key falls back
    /// to its default, so this never fails.
    pub fn load<R: Runtime>(app: &AppHandle<R>) -> Self {
        let Ok(store) = app.store(STORE_FILE) else {
            return Self::default();
        };
        let defaults = Self::default();
        Self {
            teams: string_array(store.get("teams")).unwrap_or(defaults.teams),
            penalized_bots: string_array(store.get("penalizedBots"))
                .unwrap_or(defaults.penalized_bots),
            task_regex: store
                .get("taskRegex")
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or(defaults.task_regex),
            polling_interval_sec: clamp_interval(
                store
                    .get("pollingIntervalSec")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(POLLING_INTERVAL_DEFAULT),
            ),
            auto_requeue_enabled: store
                .get("autoRequeueEnabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(defaults.auto_requeue_enabled),
            auto_requeue_max_attempts: clamp_max_attempts(
                store
                    .get("autoRequeueMaxAttempts")
                    .and_then(|v| v.as_u64())
                    .map(|n| n as u32)
                    .unwrap_or(AUTO_REQUEUE_MAX_ATTEMPTS_DEFAULT),
            ),
            auto_requeue_repos: string_array(store.get("autoRequeueRepos"))
                .unwrap_or(defaults.auto_requeue_repos),
        }
    }
}

fn clamp_interval(secs: u64) -> u64 {
    secs.clamp(POLLING_INTERVAL_MIN, POLLING_INTERVAL_MAX)
}

fn clamp_max_attempts(n: u32) -> u32 {
    n.clamp(
        AUTO_REQUEUE_MAX_ATTEMPTS_MIN,
        AUTO_REQUEUE_MAX_ATTEMPTS_MAX,
    )
}

fn string_array(value: Option<Value>) -> Option<Vec<String>> {
    let arr = value?;
    let arr = arr.as_array()?;
    Some(
        arr.iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_interval_bounds() {
        assert_eq!(clamp_interval(1), POLLING_INTERVAL_MIN);
        assert_eq!(clamp_interval(60), 60);
        assert_eq!(clamp_interval(99_999), POLLING_INTERVAL_MAX);
    }

    #[test]
    fn clamp_max_attempts_bounds() {
        assert_eq!(clamp_max_attempts(0), AUTO_REQUEUE_MAX_ATTEMPTS_MIN);
        assert_eq!(clamp_max_attempts(2), 2);
        assert_eq!(clamp_max_attempts(99), AUTO_REQUEUE_MAX_ATTEMPTS_MAX);
    }

    #[test]
    fn string_array_parses_and_filters() {
        let v = serde_json::json!(["a", 2, "b", null]);
        assert_eq!(
            string_array(Some(v)),
            Some(vec!["a".to_string(), "b".to_string()])
        );
        assert_eq!(string_array(None), None);
        assert_eq!(string_array(Some(serde_json::json!("notarray"))), None);
    }
}
