use std::sync::Mutex;
use std::time::Instant;

use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Runtime, Size,
};

use crate::poller::poll_loop::PollHandle;

pub const POPOVER_WIDTH: f64 = 440.0;
pub const POPOVER_HEIGHT: f64 = 480.0;

/// Clicking the tray icon deactivates the popover, so the resulting
/// `Focused(false)` and the `TrayIconEvent::Click` arrive with no ordering
/// guarantee. Blur-hides and clicks within this window are treated as one
/// interaction so the toggle can't fight itself.
pub const BLUR_CLICK_GRACE_MS: u128 = 300;

pub struct TrayState {
    pub pause_item: tauri::menu::MenuItem<tauri::Wry>,
}

/// Shared click/blur bookkeeping for the popover toggle.
#[derive(Default)]
pub struct TrayInteraction {
    pub last_click: Mutex<Option<Instant>>,
    pub hidden_by_blur: Mutex<Option<Instant>>,
    pub last_popover_pos: Mutex<Option<(f64, f64)>>,
}

/// Decide whether a tray click should hide the popover. A blur that hid the
/// window within the grace period was caused by this same click, so the click
/// must count as "it was visible" or click-to-close would reopen it.
pub fn should_hide_on_click(visible: bool, ms_since_blur_hide: Option<u128>) -> bool {
    visible || ms_since_blur_hide.is_some_and(|ms| ms < BLUR_CLICK_GRACE_MS)
}

/// Clamp a popover position (logical coords) so a `size`-sized window stays
/// within the `(x, y, w, h)` monitor rect, with a small margin off every edge.
pub fn clamp_to_monitor(
    pos: (f64, f64),
    size: (f64, f64),
    monitor: (f64, f64, f64, f64),
) -> (f64, f64) {
    const MARGIN: f64 = 8.0;
    let (x, y) = pos;
    let (w, h) = size;
    let (mon_x, mon_y, mon_w, mon_h) = monitor;
    (
        x.clamp(
            mon_x + MARGIN,
            (mon_x + mon_w - w - MARGIN).max(mon_x + MARGIN),
        ),
        y.clamp(
            mon_y + MARGIN,
            (mon_y + mon_h - h - MARGIN).max(mon_y + MARGIN),
        ),
    )
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItemBuilder::with_id("open", "Open Beet").build(app)?;
    let refresh = MenuItemBuilder::with_id("refresh", "Refresh now").build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let pause = MenuItemBuilder::with_id("pause", "Pause polling").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&open, &refresh, &sep1, &pause, &settings, &sep2, &quit])
        .build()?;

    app.manage(TrayState {
        pause_item: pause.clone(),
    });
    app.manage(TrayInteraction::default());

    let icon = Image::from_bytes(include_bytes!("../icons/tray-icon@2x.png"))?;

    let _tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Beet 🫜")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "refresh" => {
                if let Some(handle) = app.try_state::<PollHandle>() {
                    let current = handle.config_tx.borrow().clone();
                    let _ = handle.config_tx.send(current);
                }
            }
            "pause" => toggle_pause(app),
            "settings" => {
                let _ = app.emit("tray:open-settings", ());
                show_main_window(app);
            }
            "quit" => {
                if let Some(handle) = app.try_state::<PollHandle>() {
                    handle.cancel.cancel();
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                let app = tray.app_handle();
                let state = app.state::<TrayInteraction>();
                let now = Instant::now();
                *state.last_click.lock().unwrap() = Some(now);
                let since_blur = state
                    .hidden_by_blur
                    .lock()
                    .unwrap()
                    .map(|t| now.duration_since(t).as_millis());

                if let Some(window) = app.get_webview_window("tray") {
                    if should_hide_on_click(window.is_visible().unwrap_or(false), since_blur) {
                        let _ = window.hide();
                    } else {
                        show_popover(&window, &rect, &state);
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

fn show_popover<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    rect: &tauri::Rect,
    state: &TrayInteraction,
) {
    // Use the window's scale factor to normalise everything to logical
    // coordinates, avoiding HiDPI/Retina offset.
    let scale = window.scale_factor().unwrap_or(1.0);
    let icon_x = match rect.position {
        Position::Physical(p) => p.x as f64 / scale,
        Position::Logical(p) => p.x,
    };
    let icon_y = match rect.position {
        Position::Physical(p) => p.y as f64 / scale,
        Position::Logical(p) => p.y,
    };
    let icon_w = match rect.size {
        Size::Physical(s) => s.width as f64 / scale,
        Size::Logical(s) => s.width,
    };
    let icon_h = match rect.size {
        Size::Physical(s) => s.height as f64 / scale,
        Size::Logical(s) => s.height,
    };
    let x = icon_x + (icon_w / 2.0) - (POPOVER_WIDTH / 2.0);
    let y = icon_y + icon_h;
    let (x, y) = clamp_to_visible_area(window, x, y, icon_x + icon_w / 2.0, icon_y + icon_h / 2.0);
    show_popover_at(window, x, y);
    *state.last_popover_pos.lock().unwrap() = Some((x, y));
}

/// Clamp a target popover position against the monitor containing the given
/// reference point (falling back to the window's current monitor). All logical.
fn clamp_to_visible_area<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    x: f64,
    y: f64,
    ref_x: f64,
    ref_y: f64,
) -> (f64, f64) {
    let monitor = window
        .monitor_from_point(ref_x, ref_y)
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten());
    match monitor {
        Some(m) => {
            let ms = m.scale_factor();
            clamp_to_monitor(
                (x, y),
                (POPOVER_WIDTH, POPOVER_HEIGHT),
                (
                    m.position().x as f64 / ms,
                    m.position().y as f64 / ms,
                    m.size().width as f64 / ms,
                    m.size().height as f64 / ms,
                ),
            )
        }
        None => (x, y),
    }
}

fn show_popover_at<R: Runtime>(window: &tauri::WebviewWindow<R>, x: f64, y: f64) {
    // Force the configured size before showing — a stale window-state entry
    // (or any prior resize) must not be able to shrink the popover below its
    // design size.
    let _ = window.set_size(LogicalSize::new(POPOVER_WIDTH, POPOVER_HEIGHT));
    let _ = window.set_position(LogicalPosition::new(x, y));
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        // Restore Beet in the Dock before showing the window. macOS picks the
        // bundled icon.icns from Contents/Resources automatically — don't override.
        #[cfg(target_os = "macos")]
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn open_main_window(app: AppHandle) {
    show_main_window(&app);
}

fn toggle_pause<R: Runtime>(app: &AppHandle<R>) {
    let Some(handle) = app.try_state::<PollHandle>() else {
        return;
    };
    let current = *handle.paused_tx.borrow();
    let next = !current;
    let _ = handle.paused_tx.send(next);

    if let Some(tray_state) = app.try_state::<TrayState>() {
        let label = if next {
            "Resume polling"
        } else {
            "Pause polling"
        };
        let _ = tray_state.pause_item.set_text(label);
    }

    let _ = app.emit("tray:toggle-pause", next);
}

fn format_badge(count: u32, paused: bool) -> String {
    match (count, paused) {
        (0, false) => String::new(),
        (0, true) => "⏸".to_string(),
        (n, false) => n.to_string(),
        (n, true) => format!("⏸ {n}"),
    }
}

#[tauri::command]
pub fn set_badge(count: u32, paused: bool, app: AppHandle) -> Result<(), String> {
    let tray = app
        .tray_by_id("main")
        .ok_or_else(|| "tray icon not found".to_string())?;
    let title = format_badge(count, paused);
    tray.set_title(Some(&title))
        .map_err(|e| format!("failed to set tray title: {e}"))
}

#[cfg(test)]
mod tests {
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
    fn clamp_handles_monitor_left_of_primary() {
        // Display at negative x: a popover computed past its left edge must
        // clamp into that monitor, not the primary.
        let (x, y) = clamp_to_monitor((-2000.0, 30.0), POPOVER, (-1920.0, 0.0, 1920.0, 1080.0));
        assert_eq!((x, y), (-1920.0 + 8.0, 30.0));
    }
}
