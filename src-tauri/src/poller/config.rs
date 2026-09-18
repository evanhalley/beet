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
            standalone_runs_allowlist: string_array_map(store.get("standaloneRunsAllowlist"))
                .unwrap_or(defaults.standalone_runs_allowlist),
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
#[path = "__tests__/config.rs"]
mod tests;
