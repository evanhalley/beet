use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Manager,
};

mod error;
mod github;
mod poller;
mod scoring;
mod secure_token;
mod store;
mod tasks;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
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
            github::runs::fetch_run_jobs_command,
        ])
        .setup(|app| {
            let open = MenuItemBuilder::with_id("open", "Open Beet").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&open, &quit]).build()?;

            let icon = app
                .default_window_icon()
                .ok_or("default window icon missing")?
                .clone();

            let _tray = TrayIconBuilder::with_id("main")
                .icon(icon)
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        // Stop the poll loop before exiting so its task winds
                        // down cleanly.
                        if let Some(handle) =
                            app.try_state::<poller::poll_loop::PollHandle>()
                        {
                            handle.cancel.cancel();
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Open the SQLite DB Rust now owns (same file tauri-plugin-sql uses,
            // so existing history survives) and start the background poll loop.
            let db_path = app.path().app_data_dir()?.join("beet.db");
            if let Some(parent) = db_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let conn = store::db::open(&db_path)
                .map_err(|e| format!("failed to open beet.db: {e}"))?;
            let db = std::sync::Arc::new(std::sync::Mutex::new(conn));

            let handle = poller::poll_loop::spawn(app.handle().clone(), db.clone());
            app.manage(db);
            app.manage(handle);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
