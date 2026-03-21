//! Integrationstests für Sync: get_batch und apply_batch inkl. Abrechnungslauf-Konsistenz.
//! Ausführen mit: cargo test --features test
//! Hinweis: Wie `commands_db` — Tauri-App-Tests sind auf macOS und Linux (u. a. headless CI) per
//! `#[cfg_attr]` ignoriert; lokal auf Windows ausführen oder `--include-ignored` mit geeigneter UI-Umgebung.

mod common;

use app_lib::sync::sync_db;
use common::{insert_test_kasse_and_lauf, insert_test_kundenabrechnung, setup_test_app};
use std::env;

#[test]
#[cfg_attr(any(target_os = "macos", target_os = "linux"), ignore = "Tauri EventLoop requires dedicated UI thread; run on stable Windows CI or dedicated UI test env")]
fn get_batch_returns_abrechnungslauf_id_and_items() {
    let (_temp, _app, handle) = setup_test_app();
    let (kassen_id, lauf_id) = insert_test_kasse_and_lauf(&handle);
    insert_test_kundenabrechnung(&handle, &kassen_id, &lauf_id);

    let batch = sync_db::get_batch(&handle, &kassen_id, 0).expect("get_batch");
    assert_eq!(batch.abrechnungslauf_id.as_deref(), Some(lauf_id.as_str()));
    assert_eq!(batch.items.len(), 1);
    assert_eq!(batch.items[0].buchungen.len(), 1);
    assert_eq!(batch.items[0].buchungen[0].haendlernummer, "H1");
    assert!((batch.items[0].buchungen[0].betrag - 10.5).abs() < 1e-9);
}

#[test]
#[cfg_attr(any(target_os = "macos", target_os = "linux"), ignore = "Tauri EventLoop requires dedicated UI thread; run on stable Windows CI or dedicated UI test env")]
fn apply_batch_inserts_abrechnungen_and_buchungen_with_lauf_id() {
    let temp_slave = tempfile::TempDir::new().expect("temp slave");
    let path_slave = temp_slave.path().to_string_lossy().to_string();
    env::set_var("KASSEN_TEST_DB_DIR", &path_slave);
    let (app_slave, handle_slave) = app_lib::build_test_app();
    app_lib::db::init_db(&handle_slave).expect("init_db");
    let (kassen_id, lauf_id) = insert_test_kasse_and_lauf(&handle_slave);
    insert_test_kundenabrechnung(&handle_slave, &kassen_id, &lauf_id);
    let batch = sync_db::get_batch(&handle_slave, &kassen_id, 0).expect("get_batch");
    drop(app_slave);
    drop(handle_slave);
    drop(temp_slave);

    let temp_master = tempfile::TempDir::new().expect("temp master");
    let path_master = temp_master.path().to_string_lossy().to_string();
    env::set_var("KASSEN_TEST_DB_DIR", &path_master);
    let (_app_master, handle_master) = app_lib::build_test_app();
    app_lib::db::init_db(&handle_master).expect("init_db");
    // Gleichen Abrechnungslauf auf Master anlegen, damit apply_batch akzeptiert
    let path = app_lib::db::db_path(&handle_master).expect("db_path");
    let conn = rusqlite::Connection::open(&path).expect("open db");
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.fZ")
        .to_string();
    conn.execute(
        "INSERT INTO abrechnungslauf (id, name, start_zeitpunkt, end_zeitpunkt, is_aktiv) VALUES (?1, 'Testlauf', ?2, NULL, 1)",
        rusqlite::params![&lauf_id, &now],
    )
    .expect("insert lauf on master");

    let max_seq = sync_db::apply_batch(&handle_master, &kassen_id, &batch).expect("apply_batch");
    assert!(max_seq > 0);

    let count_ka: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM kundenabrechnung WHERE kassen_id = ?1 AND abrechnungslauf_id = ?2",
            rusqlite::params![&kassen_id, &lauf_id],
            |r| r.get(0),
        )
        .expect("count ka");
    assert_eq!(count_ka, 1);

    let count_b: i32 = conn
        .query_row("SELECT COUNT(*) FROM buchungen", [], |r| r.get(0))
        .expect("count buchungen");
    assert_eq!(count_b, 1);
}

#[test]
#[cfg_attr(any(target_os = "macos", target_os = "linux"), ignore = "Tauri EventLoop requires dedicated UI thread; run on stable Windows CI or dedicated UI test env")]
fn apply_batch_rejects_different_abrechnungslauf_id() {
    let temp_slave = tempfile::TempDir::new().expect("temp slave");
    let path_slave = temp_slave.path().to_string_lossy().to_string();
    env::set_var("KASSEN_TEST_DB_DIR", &path_slave);
    let (app_slave, handle_slave) = app_lib::build_test_app();
    app_lib::db::init_db(&handle_slave).expect("init_db");
    let (kassen_id, lauf_id_slave) = insert_test_kasse_and_lauf(&handle_slave);
    insert_test_kundenabrechnung(&handle_slave, &kassen_id, &lauf_id_slave);
    let mut batch = sync_db::get_batch(&handle_slave, &kassen_id, 0).expect("get_batch");
    drop(app_slave);
    drop(handle_slave);
    drop(temp_slave);

    let temp_master = tempfile::TempDir::new().expect("temp master");
    let path_master = temp_master.path().to_string_lossy().to_string();
    env::set_var("KASSEN_TEST_DB_DIR", &path_master);
    let (_app_master, handle_master) = app_lib::build_test_app();
    app_lib::db::init_db(&handle_master).expect("init_db");
    let lauf_id_master = uuid::Uuid::new_v4().to_string();
    let path = app_lib::db::db_path(&handle_master).expect("db_path");
    let conn = rusqlite::Connection::open(&path).expect("open db");
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.fZ")
        .to_string();
    conn.execute(
        "INSERT INTO abrechnungslauf (id, name, start_zeitpunkt, end_zeitpunkt, is_aktiv) VALUES (?1, 'MasterLauf', ?2, NULL, 1)",
        rusqlite::params![&lauf_id_master, &now],
    )
    .expect("insert lauf on master");

    batch.abrechnungslauf_id = Some(lauf_id_slave.clone());
    let result = sync_db::apply_batch(&handle_master, &kassen_id, &batch);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("anderer Abrechnungslauf") || err.contains("Abrechnungslauf"));
}

#[test]
#[cfg_attr(any(target_os = "macos", target_os = "linux"), ignore = "Tauri EventLoop requires dedicated UI thread; run on stable Windows CI or dedicated UI test env")]
fn update_last_sent_storno_creates_sync_state_row_if_missing() {
    let (_temp, _app, handle) = setup_test_app();
    let (kassen_id, _lauf_id) = insert_test_kasse_and_lauf(&handle);

    // Insert one storno for this kasse.
    let path = app_lib::db::db_path(&handle).expect("db_path");
    let conn = rusqlite::Connection::open(&path).expect("open db");
    let storno_id = uuid::Uuid::new_v4().to_string();
    let buchung_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.fZ")
        .to_string();
    conn.execute(
        "INSERT INTO stornos (id, buchung_id, kassen_id, zeitstempel) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![&storno_id, &buchung_id, &kassen_id, &now],
    )
    .expect("insert storno");

    // sync_state row for peer must be created by update_last_sent_storno.
    let peer_id = "peer-1";
    sync_db::update_last_sent_storno(&handle, peer_id, &now).expect("update_last_sent_storno");

    let v: Option<String> = conn
        .query_row(
            "SELECT last_sent_storno_zeitstempel FROM sync_state WHERE peer_kassen_id = ?1",
            rusqlite::params![peer_id],
            |r| r.get(0),
        )
        .ok();
    assert_eq!(v.as_deref(), Some(now.as_str()));
}

#[test]
#[cfg_attr(any(target_os = "macos", target_os = "linux"), ignore = "Tauri EventLoop requires dedicated UI thread; run on stable Windows CI or dedicated UI test env")]
fn get_max_storno_zeitstempel_for_kasse_returns_max() {
    let (_temp, _app, handle) = setup_test_app();
    let (kassen_id, _lauf_id) = insert_test_kasse_and_lauf(&handle);

    let path = app_lib::db::db_path(&handle).expect("db_path");
    let conn = rusqlite::Connection::open(&path).expect("open db");

    let ts1 = "2026-01-01T10:00:00.000Z".to_string();
    let ts2 = "2026-01-01T11:00:00.000Z".to_string();
    for ts in [&ts1, &ts2] {
        let storno_id = uuid::Uuid::new_v4().to_string();
        let buchung_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO stornos (id, buchung_id, kassen_id, zeitstempel) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![&storno_id, &buchung_id, &kassen_id, ts],
        )
        .expect("insert storno");
    }

    let max_ts = sync_db::get_max_storno_zeitstempel_for_kasse(&handle, &kassen_id)
        .expect("get_max_storno_zeitstempel_for_kasse");
    assert_eq!(max_ts.as_deref(), Some(ts2.as_str()));
}
