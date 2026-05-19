//! Poll configuration: the subset of Beet settings the Rust poll loop needs.
//! Loaded from tauri-plugin-store (`config.json`) — the same store the
//! Settings UI writes. Keys and defaults mirror `src/lib/storage/settings.ts`.

use crate::tasks::DEFAULT_TASK_REGEX;
use serde_json::Value;
use std::collections::HashMap;
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
    /// Per-repo allowlist of workflow names for the Standalone Runs section
    /// (#6 noise control). Key = `owner/repo`, value = workflow display names.
    /// Empty map / missing repo = show all (still deduped per workflow);
    /// non-empty entry = restrict that repo's standalone runs to just the
    /// listed workflows.
    pub standalone_runs_allowlist: HashMap<String, Vec<String>>,
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
            standalone_runs_allowlist: HashMap::new(),
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
            standalone_runs_allowlist: string_array_map(
                store.get("standaloneRunsAllowlist"),
            )
            .unwrap_or(defaults.standalone_runs_allowlist),
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

/// Parse `{ "owner/repo": ["WorkflowA", "WorkflowB"], ... }` shape.
/// Non-array values are dropped; empty-string and empty-array entries are
/// kept as-is (the caller treats an empty list as "no filter for this repo").
fn string_array_map(value: Option<Value>) -> Option<HashMap<String, Vec<String>>> {
    let obj = value?;
    let obj = obj.as_object()?;
    let mut out = HashMap::with_capacity(obj.len());
    for (k, v) in obj {
        let Some(arr) = v.as_array() else { continue };
        let list: Vec<String> = arr
            .iter()
            .filter_map(|item| item.as_str().map(String::from))
            .collect();
        out.insert(k.clone(), list);
    }
    Some(out)
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

    #[test]
    fn string_array_map_parses_object_of_string_lists() {
        let v = serde_json::json!({
            "foo/bar": ["Deploy", "Release"],
            "baz/qux": [],
            "skipped/non-array": "nope",
        });
        let parsed = string_array_map(Some(v)).unwrap();
        assert_eq!(
            parsed.get("foo/bar").unwrap(),
            &vec!["Deploy".to_string(), "Release".to_string()]
        );
        // Empty array is preserved (caller treats as "no filter for this repo").
        assert_eq!(parsed.get("baz/qux").unwrap(), &Vec::<String>::new());
        // Non-array value is dropped entirely.
        assert!(!parsed.contains_key("skipped/non-array"));
    }

    #[test]
    fn string_array_map_handles_missing_and_non_object() {
        assert!(string_array_map(None).is_none());
        assert!(string_array_map(Some(serde_json::json!("notobj"))).is_none());
        assert!(string_array_map(Some(serde_json::json!([1, 2]))).is_none());
    }
}
