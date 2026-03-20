pub mod commands;
pub mod db;
mod discovery;
mod tls;
pub mod sync;
pub mod user_error;

/// Einmalige Erzeugung des Tauri-Kontexts (vermeidet doppelte Symbol-Definition in Tests).
fn tauri_context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

fn app_builder() -> tauri::Builder<tauri::Wry> {
    let builder = tauri::Builder::default();
    // In Integrationstests wird die App von libtest in einem Test-Thread gebaut.
    // Auf Linux/Windows muss dafür der Tao-EventLoop explizit für "any thread" erlaubt werden,
    // sonst panikt Tao mit "EventLoop outside of the main thread".
    #[cfg(all(feature = "test", any(target_os = "linux", target_os = "windows")))]
    let builder = builder.any_thread();

    builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(commands::MasterServerState(std::sync::Mutex::new(None)))
        .manage(commands::MdnsDaemonState(std::sync::Mutex::new(None)))
        .manage(commands::SyncRuntimeState::default())
        .manage(crate::sync::status::SyncStatusState::new())
        .manage(crate::sync::server::SyncConnectionsState::new())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::init_db,
            commands::wipe_local_data,
            commands::get_notfall_export_data,
            commands::import_notfall_data,
            commands::get_join_token,
            commands::generate_join_token,
            commands::start_master_server,
            commands::is_master_server_running,
            commands::get_join_requests,
            commands::approve_join_request,
            commands::reject_join_request,
            commands::join_network,
            commands::start_sync_connections,
            commands::get_sync_runtime_status,
            commands::get_haendler_list,
            commands::create_haendler,
            commands::update_haendler,
            commands::delete_haendler,
            commands::storno_position,
            commands::storno_abrechnung,
            commands::get_recent_abrechnungen,
            commands::get_buchungen_for_abrechnung,
            commands::get_haendler_umsatz,
            commands::get_haendler_abrechnung_pdf_data,
            commands::get_buchungen_for_haendler,
            commands::get_sync_status,
            commands::remove_peer_from_network,
            commands::discover_masters,
            commands::reset_abrechnungslauf,
            commands::get_abrechnungsläufe,
            commands::create_abrechnungslauf,
            commands::delete_abrechnungslauf,
            commands::request_slave_reset,
            commands::request_closeout,
            commands::leave_network,
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app_builder()
        .run(tauri_context())
        .expect("error while running tauri application");
}

/// Für Integrationstests: baut die App (ohne Event-Loop zu starten) und gibt App + Handle zurück.
/// Vor dem Aufruf muss KASSEN_TEST_DB_DIR auf ein temporäres Verzeichnis gesetzt werden.
#[cfg(feature = "test")]
pub fn build_test_app() -> (tauri::App<tauri::Wry>, tauri::AppHandle) {
    let mut builder = app_builder();
    if let Ok(dir) = std::env::var("KASSEN_TEST_DB_DIR") {
        builder = builder.manage(crate::db::TestInstanceDir(std::path::PathBuf::from(dir)));
    }
    let app = builder
        .build(tauri_context())
        .expect("failed to build app for test");
    let handle = app.handle().clone();
    (app, handle)
}
