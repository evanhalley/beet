use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, LogicalPosition, Position, Runtime, Size,
};

use crate::poller::poll_loop::PollHandle;

/// Re-set the macOS dock icon after toggling activation policy.
/// When switching from Accessory → Regular, macOS sometimes shows a generic
/// "exec" icon instead of the bundled app icon. Explicitly setting
/// `applicationIconImage` from the bundled icon data fixes this.
/// Public entry point for callers outside this module (e.g. single-instance handler).
#[cfg(target_os = "macos")]
pub fn refresh_dock_icon_pub() {
    refresh_dock_icon();
}

#[cfg(target_os = "macos")]
fn refresh_dock_icon() {
    use objc2::AnyThread;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    static ICON_BYTES: &[u8] = include_bytes!("../icons/icon.png");

    // This runs on the main thread (Tauri UI callbacks are always main-thread).
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    unsafe {
        let data = NSData::with_bytes(ICON_BYTES);
        if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
            let app = NSApplication::sharedApplication(mtm);
            app.setApplicationIconImage(Some(&image));
        }
    }
}

pub struct TrayState {
    pub pause_item: tauri::menu::MenuItem<tauri::Wry>,
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
                if let Some(window) = app.get_webview_window("tray") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        // Use the window's scale factor to normalise everything
                        // to logical coordinates, avoiding HiDPI/Retina offset.
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
                        let popover_width = 360.0_f64;
                        let x = icon_x + (icon_w / 2.0) - (popover_width / 2.0);
                        let y = icon_y + icon_h;
                        let _ = window.set_position(LogicalPosition::new(x, y));
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        // Restore Beet in the Dock before showing the window.
        #[cfg(target_os = "macos")]
        {
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
            refresh_dock_icon();
        }
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
}
