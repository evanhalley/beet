use tauri::Manager;

mod error;
mod github;
mod mock;
mod poller;
mod scoring;
mod secure_token;
mod store;
mod tasks;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // Only the summon chord is ever registered; ignore repeats
                    // and the release half of the press.
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        tray::toggle_popover(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        // Exclude the tray popover: it's sized by tauri.conf.json and positioned
        // programmatically on each open. Letting window-state persist/restore it
        // lets a stale per-machine entry shrink the popover (the `main` window
        // still benefits from remembered size/position).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["tray"])
                .build(),
        );

    // OS notifications — macOS only in V1 (§13).
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_notifications::init());

    builder
        .invoke_handler(tauri::generate_handler![
            secure_token::store_token,
            secure_token::get_token,
            secure_token::clear_token,
            poller::poll_loop::update_poll_config,
            poller::poll_loop::refresh_now,
            poller::poll_loop::set_poll_paused,
            poller::poll_loop::notify_token_changed,
            store::requeue::get_requeue_count,
            store::requeue::get_requeue_opt_out,
            store::requeue::set_requeue_opt_out,
            store::mute_pin::list_mutes,
            store::mute_pin::add_mute,
            store::mute_pin::remove_mute,
            store::mute_pin::list_pins,
            store::mute_pin::add_pin,
            store::mute_pin::remove_pin,
            store::suppress::list_suppressions,
            store::suppress::add_suppression,
            store::suppress::remove_suppression,
            store::snooze::list_snoozes,
            store::snooze::add_snooze,
            store::snooze::remove_snooze,
            store::notifications::check_and_record_notification,
            store::notifications::record_notification_link,
            store::notifications::get_notification_link,
            github::runs::fetch_run_jobs_command,
            mock::is_mock_mode,
            tray::set_badge,
            tray::open_main_window,
            tray::set_global_shortcut_enabled,
        ])
        .setup(|app| {
            // Open the SQLite DB and start the background poll loop before
            // setting up the tray — the tray menu handler needs PollHandle.
            let db_path = app.path().app_data_dir()?.join("beet.db");
            if let Some(parent) = db_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let conn =
                store::db::open(&db_path).map_err(|e| format!("failed to open beet.db: {e}"))?;
            let db = std::sync::Arc::new(std::sync::Mutex::new(conn));

            let handle = poller::poll_loop::spawn(app.handle().clone(), db.clone());
            app.manage(db);
            app.manage(handle);

            tray::setup(app)?;

            // Register the global summon chord unless the user disabled it.
            // Same config.json store the poller reads; missing key = enabled.
            {
                use tauri_plugin_store::StoreExt;
                let enabled = app
                    .store("config.json")
                    .ok()
                    .and_then(|s| s.get("globalShortcutEnabled"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                if enabled {
                    if let Err(e) = tray::set_shortcut_registered(app.handle(), true) {
                        eprintln!("beet: {e}");
                    }
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
                // Hide Beet from the Dock when no windows are visible.
                #[cfg(target_os = "macos")]
                let _ = window
                    .app_handle()
                    .set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
            tauri::WindowEvent::Focused(false) if window.label() == "tray" => {
                // Clicking the tray icon blurs the popover; that blur must not
                // hide the window the click handler is about to show (and the
                // click handler must know a blur already closed it). See
                // tray::TrayInteraction.
                let state = window.app_handle().state::<tray::TrayInteraction>();
                let recently_clicked = state
                    .last_click
                    .lock()
                    .unwrap()
                    .is_some_and(|t| t.elapsed().as_millis() < tray::BLUR_CLICK_GRACE_MS);
                if !recently_clicked && window.is_visible().unwrap_or(false) {
                    let _ = window.hide();
                    *state.hidden_by_blur.lock().unwrap() = Some(std::time::Instant::now());
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
