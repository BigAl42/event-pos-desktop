//! Integrationstests für Notfall-Import (CSV/XLSX Parsing ist Frontend; hier nur DB-Import via Command).
//! Ausführen mit: cargo test --features test
//! Hinweis: Tests, die die Tauri-App bauen, laufen nur auf Linux/Windows (macOS verlangt EventLoop auf dem Main-Thread).

mod common;

use app_lib::commands;
use common::{insert_test_kasse_and_lauf, setup_test_app};

fn sample_payload(export_lauf_id: &str) -> commands::NotfallExportDto {
    commands::NotfallExportDto {
        meta: commands::NotfallExportMeta {
            exported_lauf_id: export_lauf_id.to_string(),
            exported_lauf_name: "ExportLauf".to_string(),
            exported_lauf_start_zeitpunkt: "2026-03-18T10:00:00.000Z".to_string(),
            exported_lauf_end_zeitpunkt: None,
            export_at: "2026-03-18T11:00:00.000Z".to_string(),
            exporting_kasse_id: Some("kasse-export".to_string()),
            exporting_kasse_name: Some("Kasse Export".to_string()),
        },
        kassen: vec![commands::NotfallKasseRow {
            id: "kasse-export".to_string(),
            name: "Kasse Export".to_string(),
            is_master: 0,
            ws_url: None,
        }],
        kundenabrechnungen: vec![commands::NotfallKundenabrechnungRow {
            id: "ka-1".to_string(),
            kassen_id: "kasse-export".to_string(),
            person1_name: Some("A".to_string()),
            person2_name: Some("B".to_string()),
            zeitstempel: "2026-03-18T10:05:00.000Z".to_string(),
            belegnummer: Some("BELEG-1".to_string()),
            sequence: 1,
            abrechnungslauf_id: Some(export_lauf_id.to_string()),
        }],
        buchungen: vec![commands::NotfallBuchungRow {
            id: "b-1".to_string(),
            kundenabrechnung_id: "ka-1".to_string(),
            haendlernummer: "H1".to_string(),
            betrag: 10.5,
            bezeichnung: Some("Test".to_string()),
        }],
        stornos: vec![commands::NotfallStornoRow {
            id: "s-1".to_string(),
            buchung_id: "b-1".to_string(),
            kassen_id: "kasse-export".to_string(),
            zeitstempel: "2026-03-18T10:06:00.000Z".to_string(),
            kundenabrechnung_id: Some("ka-1".to_string()),
        }],
    }
}

#[test]
#[cfg_attr(
    any(target_os = "macos", target_os = "linux"),
    ignore = "Tauri EventLoop requires dedicated UI thread; run on Windows CI or dedicated UI test env"
)]
fn import_notfall_data_inserts_and_is_idempotent() {
    let (_temp, _app, handle) = setup_test_app();
    let (_kassen_id, target_lauf_id) = insert_test_kasse_and_lauf(&handle);

    // Export-Lauf passt absichtlich nicht, wir erlauben mismatch.
    let payload = sample_payload("export-lauf-1");
    let summary1 = commands::import_notfall_data(handle.clone(), payload.clone(), target_lauf_id.clone(), true)
        .expect("import_notfall_data");
    assert_eq!(summary1.inserted_kassen, 1);
    assert_eq!(summary1.inserted_kundenabrechnungen, 1);
    assert_eq!(summary1.inserted_buchungen, 1);
    assert_eq!(summary1.inserted_stornos, 1);

    // Zweiter Import: alles sollte ignoriert werden (INSERT OR IGNORE)
    let summary2 = commands::import_notfall_data(handle.clone(), payload, target_lauf_id, true)
        .expect("import_notfall_data 2");
    assert_eq!(summary2.inserted_kassen, 0);
    assert_eq!(summary2.ignored_kassen, 1);
    assert_eq!(summary2.inserted_kundenabrechnungen, 0);
    assert_eq!(summary2.ignored_kundenabrechnungen, 1);
    assert_eq!(summary2.inserted_buchungen, 0);
    assert_eq!(summary2.ignored_buchungen, 1);
    assert_eq!(summary2.inserted_stornos, 0);
    assert_eq!(summary2.ignored_stornos, 1);
}

#[test]
#[cfg_attr(
    any(target_os = "macos", target_os = "linux"),
    ignore = "Tauri EventLoop requires dedicated UI thread; run on Windows CI or dedicated UI test env"
)]
fn import_notfall_data_blocks_when_mismatch_not_allowed() {
    let (_temp, _app, handle) = setup_test_app();
    let (_kassen_id, target_lauf_id) = insert_test_kasse_and_lauf(&handle);

    let payload = sample_payload("export-lauf-1");
    let err = commands::import_notfall_data(handle, payload, target_lauf_id, false)
        .err()
        .expect("expected error");
    // user_msg returns JSON with i18n code (not localized prose in Rust tests).
    assert!(
        err.contains("errors.notfall_import.billing_cycle_mismatch")
            || err.to_lowercase().contains("abbruch")
            || err.to_lowercase().contains("abgebrochen")
    );
}

