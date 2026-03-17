//! Gemeinsame Hilfsfunktionen für Integrationstests: temporäre DB und App-Handle.

use app_lib::{self, db};
use std::env;
use tempfile::TempDir;

/// Richtet eine temporäre DB ein, startet die App (ohne Event-Loop) und führt Migrationen aus.
/// Gibt das TempDir (halten, damit das Verzeichnis nicht gelöscht wird), die App und den Handle zurück.
pub fn setup_test_app() -> (TempDir, tauri::App<tauri::Wry>, tauri::AppHandle) {
    let temp = TempDir::new().expect("temp dir");
    let path = temp.path().to_string_lossy().to_string();
    env::set_var("KASSEN_TEST_DB_DIR", &path);

    let (app, handle) = app_lib::build_test_app();
    db::init_db(&handle).expect("init_db");
    (temp, app, handle)
}

/// Legt eine Kasse und einen aktiven Abrechnungslauf in der Test-DB an.
/// Gibt (kassen_id, abrechnungslauf_id) zurück.
pub fn insert_test_kasse_and_lauf(handle: &tauri::AppHandle) -> (String, String) {
    let kassen_id = uuid::Uuid::new_v4().to_string();
    let lauf_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.fZ")
        .to_string();

    let path = db::db_path(handle).expect("db_path");
    let conn = rusqlite::Connection::open(&path).expect("open db");

    conn.execute(
        "INSERT INTO kassen (id, name, person1_name, person2_name, is_master) VALUES (?1, 'Testkasse', 'A', 'B', 0)",
        rusqlite::params![&kassen_id],
    )
    .expect("insert kasse");

    conn.execute(
        "INSERT INTO abrechnungslauf (id, name, start_zeitpunkt, end_zeitpunkt, is_aktiv) VALUES (?1, 'Testlauf', ?2, NULL, 1)",
        rusqlite::params![&lauf_id, &now],
    )
    .expect("insert lauf");

    db::set_config(handle, "kassen_id", &kassen_id).expect("set kassen_id");

    (kassen_id, lauf_id)
}

/// Fügt eine Kundenabrechnung mit einer Buchung ein (für Abrechnungslauf-Tests).
pub fn insert_test_kundenabrechnung(
    handle: &tauri::AppHandle,
    kassen_id: &str,
    abrechnungslauf_id: &str,
) -> (String, String) {
    let ka_id = uuid::Uuid::new_v4().to_string();
    let buchung_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.fZ")
        .to_string();

    let path = db::db_path(handle).expect("db_path");
    let conn = rusqlite::Connection::open(&path).expect("open db");

    let sequence: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM kundenabrechnung WHERE kassen_id = ?1",
            rusqlite::params![kassen_id],
            |r| r.get(0),
        )
        .expect("sequence");

    conn.execute(
        "INSERT INTO kundenabrechnung (id, kassen_id, person1_name, person2_name, zeitstempel, belegnummer, sequence, abrechnungslauf_id) VALUES (?1, ?2, 'A', 'B', ?3, 'BELEG-1', ?4, ?5)",
        rusqlite::params![&ka_id, kassen_id, &now, sequence, abrechnungslauf_id],
    )
    .expect("insert kundenabrechnung");

    conn.execute(
        "INSERT INTO buchungen (id, kundenabrechnung_id, haendlernummer, betrag, bezeichnung) VALUES (?1, ?2, 'H1', 10.5, 'Test')",
        rusqlite::params![&buchung_id, &ka_id],
    )
    .expect("insert buchung");

    (ka_id, buchung_id)
}
