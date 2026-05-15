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
}

impl Default for PollConfig {
    fn default() -> Self {
        Self {
            teams: Vec::new(),
            penalized_bots: Vec::new(),
            task_regex: DEFAULT_TASK_REGEX.to_string(),
            polling_interval_sec: POLLING_INTERVAL_DEFAULT,
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
        }
    }
}

fn clamp_interval(secs: u64) -> u64 {
    secs.clamp(POLLING_INTERVAL_MIN, POLLING_INTERVAL_MAX)
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
