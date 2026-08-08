
use super::*;

#[test]
fn format_badge_empty_when_zero_and_active() {
    assert_eq!(format_badge(0, false), "");
}

#[test]
fn format_badge_pause_glyph_when_zero_and_paused() {
    assert_eq!(format_badge(0, true), "⏸");
}

#[test]
fn format_badge_count_when_active() {
    assert_eq!(format_badge(3, false), "3");
}

#[test]
fn format_badge_pause_glyph_with_count() {
    assert_eq!(format_badge(3, true), "⏸ 3");
}

#[test]
fn hides_when_popover_visible() {
    assert!(should_hide_on_click(true, None));
}

#[test]
fn hides_when_blur_just_hid_it() {
    // Blur-then-click ordering: blur hid the popover 100ms ago, so the
    // click that caused the blur must not re-show it.
    assert!(should_hide_on_click(false, Some(100)));
}

#[test]
fn shows_when_blur_hide_is_stale() {
    assert!(!should_hide_on_click(false, Some(500)));
}

#[test]
fn shows_when_hidden_with_no_prior_blur() {
    assert!(!should_hide_on_click(false, None));
}

const POPOVER: (f64, f64) = (440.0, 480.0);

#[test]
fn clamp_keeps_on_screen_position_unchanged() {
    let (x, y) = clamp_to_monitor((100.0, 30.0), POPOVER, (0.0, 0.0, 1512.0, 982.0));
    assert_eq!((x, y), (100.0, 30.0));
}

#[test]
fn clamp_pulls_right_edge_overflow_back_on_screen() {
    let (x, y) = clamp_to_monitor((1400.0, 30.0), POPOVER, (0.0, 0.0, 1512.0, 982.0));
    assert_eq!((x, y), (1512.0 - 440.0 - 8.0, 30.0));
}

#[test]
fn fallback_position_centers_on_primary_monitor() {
    let (x, y) = fallback_position(0.0, 0.0, 1512.0);
    assert_eq!((x, y), ((1512.0 - POPOVER_WIDTH) / 2.0, 30.0));
}

#[test]
fn fallback_position_centers_on_monitor_left_of_primary() {
    let (x, y) = fallback_position(-1920.0, 0.0, 1920.0);
    assert_eq!((x, y), (-1920.0 + (1920.0 - POPOVER_WIDTH) / 2.0, 30.0));
}

#[test]
fn clamp_handles_monitor_left_of_primary() {
    // Display at negative x: a popover computed past its left edge must
    // clamp into that monitor, not the primary.
    let (x, y) = clamp_to_monitor((-2000.0, 30.0), POPOVER, (-1920.0, 0.0, 1920.0, 1080.0));
    assert_eq!((x, y), (-1920.0 + 8.0, 30.0));
}
