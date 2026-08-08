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

/// Single source of truth for the summon chord until a recorder UI exists.
pub const TOGGLE_SHORTCUT: &str = "Alt+Shift+B";

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

/// Toggle the popover without a tray-icon rect (global shortcut). Position
/// falls back to where the popover last opened, then to the top-center of the
/// monitor under the cursor, then to the primary monitor.
pub fn toggle_popover<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("tray") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    let state = app.state::<TrayInteraction>();
    let (x, y) = match *state.last_popover_pos.lock().unwrap() {
        Some(pos) => pos,
        None => {
            let monitor = app
                .cursor_position()
                .ok()
                .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
                .or_else(|| app.primary_monitor().ok().flatten());
            match monitor {
                Some(m) => {
                    let ms = m.scale_factor();
                    let (x, y) = fallback_position(
                        m.position().x as f64 / ms,
                        m.position().y as f64 / ms,
                        m.size().width as f64 / ms,
                    );
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
                None => (0.0, 30.0),
            }
        }
    };
    show_popover_at(&window, x, y);
    *state.last_popover_pos.lock().unwrap() = Some((x, y));
}

/// Top-center of a monitor (logical coords), just below the menu bar.
pub fn fallback_position(mon_x: f64, mon_y: f64, mon_w: f64) -> (f64, f64) {
    (mon_x + (mon_w - POPOVER_WIDTH) / 2.0, mon_y + 30.0)
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

/// Register or unregister the summon chord at runtime (Settings toggle).
#[tauri::command]
pub fn set_global_shortcut_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    set_shortcut_registered(&app, enabled)
}

pub fn set_shortcut_registered<R: Runtime>(
    app: &AppHandle<R>,
    enabled: bool,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let shortcuts = app.global_shortcut();
    if enabled {
        if !shortcuts.is_registered(TOGGLE_SHORTCUT) {
            shortcuts
                .register(TOGGLE_SHORTCUT)
                .map_err(|e| format!("failed to register {TOGGLE_SHORTCUT}: {e}"))?;
        }
    } else {
        let _ = shortcuts.unregister(TOGGLE_SHORTCUT);
    }
    Ok(())
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
#[path = "__tests__/tray.rs"]
mod tests;
