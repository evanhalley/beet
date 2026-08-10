
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
    let s = AdaptiveSignals {
        window_hidden: true,
        ..base(60)
    };
    assert_eq!(effective_interval(&s), Duration::from_secs(120));
}

#[test]
fn battery_doubles() {
    let s = AdaptiveSignals {
        on_battery: true,
        ..base(60)
    };
    assert_eq!(effective_interval(&s), Duration::from_secs(120));
}

#[test]
fn rate_limited_quadruples() {
    let s = AdaptiveSignals {
        rate_limited: true,
        ..base(60)
    };
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
    assert_eq!(
        effective_interval(&s),
        Duration::from_secs(MAX_INTERVAL_SECS)
    );
}

#[test]
fn retry_after_respects_the_cap() {
    // A wildly large Retry-After is still clamped to the hard ceiling.
    let s = AdaptiveSignals {
        retry_after_secs: Some(100_000),
        ..base(60)
    };
    assert_eq!(
        effective_interval(&s),
        Duration::from_secs(MAX_INTERVAL_SECS)
    );
}

#[test]
fn pinned_repos_skips_multipliers_but_respects_retry_after() {
    // Battery/hidden/rate-limit multipliers are bypassed, but an explicit
    // Retry-After is still honoured — we must never poll sooner than asked.
    let s = AdaptiveSignals {
        has_pinned_repos: true,
        window_hidden: true,
        on_battery: true,
        rate_limited: true,
        retry_after_secs: Some(300),
        ..base(60)
    };
    assert_eq!(effective_interval(&s), Duration::from_secs(300));
}

#[test]
fn pinned_repos_without_retry_after_uses_base() {
    // No Retry-After → use base interval, ignoring all multipliers.
    let s = AdaptiveSignals {
        has_pinned_repos: true,
        window_hidden: true,
        on_battery: true,
        rate_limited: true,
        retry_after_secs: None,
        ..base(60)
    };
    assert_eq!(effective_interval(&s), Duration::from_secs(60));
}

#[test]
fn pinned_repos_false_leaves_other_multipliers_intact() {
    // Ensure the new field doesn't silently break the existing path.
    let s = AdaptiveSignals {
        rate_limited: true,
        ..base(60)
    };
    assert_eq!(effective_interval(&s), Duration::from_secs(240));
}
