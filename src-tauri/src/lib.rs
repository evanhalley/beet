use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_sql::{Migration, MigrationKind};

mod secure_token;

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create etag_cache table",
            sql: "CREATE TABLE IF NOT EXISTS etag_cache (
            cache_key  TEXT PRIMARY KEY,
            etag       TEXT NOT NULL,
            body_json  TEXT NOT NULL,
            fetched_at TEXT NOT NULL
        );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create pr_lifecycle_history table",
            sql: "CREATE TABLE IF NOT EXISTS pr_lifecycle_history (
            pr_id       TEXT NOT NULL,
            lifecycle   TEXT NOT NULL,
            observed_at TEXT NOT NULL,
            PRIMARY KEY (pr_id, observed_at)
        );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create pr_ejection_events table",
            sql: "CREATE TABLE IF NOT EXISTS pr_ejection_events (
            pr_id               TEXT NOT NULL,
            observed_at         TEXT NOT NULL,
            head_sha            TEXT NOT NULL,
            failing_checks_json TEXT NOT NULL,
            PRIMARY KEY (pr_id, observed_at)
        );",
            kind: MigrationKind::Up,
        },
    ]
}

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
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:beet.db", migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            secure_token::store_token,
            secure_token::get_token,
            secure_token::clear_token,
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
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
