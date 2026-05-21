//! Adaptive polling (§7). Stretches the poll interval based on environmental
//! signals the user shouldn't have to think about:
//!
//! - Window hidden → `×2`. The app keeps polling from the tray, but slower —
//!   nothing on screen needs sub-minute freshness.
//! - On battery → `×2`. Don't drain a sleeping laptop.
//! - Rate-limited (core bucket < 100 remaining, or a poll cycle hit
//!   429 / 403+rate-limit) → `×4`, and we never re-poll sooner than the
//!   `Retry-After` GitHub gave us.
//!
//! `effective_interval` is a pure function so the policy is straightforward to
//! test in isolation; the OS lookups live in their own small helpers.

use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};

const HIDDEN_MULTIPLIER: u64 = 2;
const BATTERY_MULTIPLIER: u64 = 2;
const RATE_LIMITED_MULTIPLIER: u64 = 4;
/// Hard cap on the computed interval — keeps a stack of multipliers from
/// pushing us into "polls once a day" territory.
const MAX_INTERVAL_SECS: u64 = 3600;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AdaptiveSignals {
    /// The configured base interval, already clamped to `[15, 600]`.
    pub base_secs: u64,
    pub window_hidden: bool,
    pub on_battery: bool,
    /// Whether the just-completed cycle was rate-limited (low core-bucket
    /// remaining, or a `RateLimited` error variant).
    pub rate_limited: bool,
    /// `Retry-After` seconds from a rate-limit response. Used as a floor —
    /// we never re-poll sooner than GitHub asked.
    pub retry_after_secs: Option<u64>,
    /// At least one repo is pinned (§8). Pinned repos always get the fast
    /// (base) interval — this overrides every other multiplier, including
    /// rate-limit pressure, so pinned repos stay fresh.
    pub has_pinned_repos: bool,
}

pub fn effective_interval(s: &AdaptiveSignals) -> Duration {
    // Pinned repos take priority: always return the base interval unchanged.
    if s.has_pinned_repos {
        return Duration::from_secs(s.base_secs.clamp(1, MAX_INTERVAL_SECS));
    }
    let mut secs = s.base_secs.max(1);
    if s.window_hidden {
        secs = secs.saturating_mul(HIDDEN_MULTIPLIER);
    }
    if s.on_battery {
        secs = secs.saturating_mul(BATTERY_MULTIPLIER);
    }
    if s.rate_limited {
        secs = secs.saturating_mul(RATE_LIMITED_MULTIPLIER);
    }
    if let Some(retry) = s.retry_after_secs {
        // GitHub-supplied wait is an explicit floor, not a multiplier.
        secs = secs.max(retry);
    }
    Duration::from_secs(secs.min(MAX_INTERVAL_SECS))
}

/// `true` when the main window has been hidden (e.g. user closed it via the
/// red traffic light; per §12 the app keeps polling from the tray). Defaults
/// to "visible" if we can't tell — never aggressively back off on uncertainty.
pub fn is_window_hidden<R: Runtime>(app: &AppHandle<R>) -> bool {
    !app.get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(true)
}

/// `true` when at least one battery is currently discharging. Returns `false`
/// for desktops, AC-connected laptops, and any case where the OS lookup fails.
pub fn is_on_battery() -> bool {
    let Ok(manager) = starship_battery::Manager::new() else {
        return false;
    };
    let Ok(batteries) = manager.batteries() else {
        return false;
    };
    batteries
        .flatten()
        .any(|b| b.state() == starship_battery::State::Discharging)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(base_secs: u64) -> AdaptiveSignals {
        AdaptiveSignals {
            base_secs,
            window_hidden: false,
            on_battery: false,
            rate_limited: false,
            retry_after_secs: None,
            has_pinned_repos: false,
        }
    }

    #[test]
    fn base_interval_passes_through() {
        assert_eq!(effective_interval(&base(60)), Duration::from_secs(60));
    }

    #[test]
    fn hidden_window_doubles() {
        let s = AdaptiveSignals { window_hidden: true, ..base(60) };
        assert_eq!(effective_interval(&s), Duration::from_secs(120));
    }

    #[test]
    fn battery_doubles() {
        let s = AdaptiveSignals { on_battery: true, ..base(60) };
        assert_eq!(effective_interval(&s), Duration::from_secs(120));
    }

    #[test]
    fn rate_limited_quadruples() {
        let s = AdaptiveSignals { rate_limited: true, ..base(60) };
        assert_eq!(effective_interval(&s), Duration::from_secs(240));
    }

    #[test]
    fn multipliers_compose() {
        // Hidden + battery + rate-limited = ×16.
        let s = AdaptiveSignals {
            window_hidden: true,
            on_battery: true,
            rate_limited: true,
            ..base(60)
        };
        assert_eq!(effective_interval(&s), Duration::from_secs(960));
    }

    #[test]
    fn retry_after_acts_as_floor() {
        // Computed = 60s, retry-after = 300s → wait 300s.
        let s = AdaptiveSignals {
            retry_after_secs: Some(300),
            ..base(60)
        };
        assert_eq!(effective_interval(&s), Duration::from_secs(300));
    }

    #[test]
    fn retry_after_below_computed_is_ignored() {
        // Computed = 240s (rate-limited), retry-after = 30s → 240 wins.
        let s = AdaptiveSignals {
            rate_limited: true,
            retry_after_secs: Some(30),
            ..base(60)
        };
        assert_eq!(effective_interval(&s), Duration::from_secs(240));
    }

    #[test]
    fn interval_is_capped() {
        // Base 600 × 2 × 2 × 4 = 9600, clamped to 3600.
        let s = AdaptiveSignals {
            window_hidden: true,
            on_battery: true,
            rate_limited: true,
            ..base(600)
        };
        assert_eq!(effective_interval(&s), Duration::from_secs(MAX_INTERVAL_SECS));
    }

    #[test]
    fn retry_after_respects_the_cap() {
        // A wildly large Retry-After is still clamped to the hard ceiling.
        let s = AdaptiveSignals {
            retry_after_secs: Some(100_000),
            ..base(60)
        };
        assert_eq!(effective_interval(&s), Duration::from_secs(MAX_INTERVAL_SECS));
    }

    #[test]
    fn pinned_repos_overrides_all_multipliers() {
        // Even rate-limit + battery + hidden cannot stretch the interval when
        // any repos are pinned — fast polling is the invariant.
        let s = AdaptiveSignals {
            has_pinned_repos: true,
            window_hidden: true,
            on_battery: true,
            rate_limited: true,
            retry_after_secs: Some(300),
            ..base(60)
        };
        assert_eq!(effective_interval(&s), Duration::from_secs(60));
    }

    #[test]
    fn pinned_repos_false_leaves_other_multipliers_intact() {
        // Ensure the new field doesn't silently break the existing path.
        let s = AdaptiveSignals { rate_limited: true, ..base(60) };
        assert_eq!(effective_interval(&s), Duration::from_secs(240));
    }
}
