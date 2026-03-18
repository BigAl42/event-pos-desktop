//! Integrationstests für DB-Commands: get_haendler_umsatz, get_recent_abrechnungen, Storno, Buchungen.
//! Ausführen mit: cargo test --features test
//! Hinweis: Tests, die die Tauri-App bauen, laufen nur auf Linux/Windows (macOS verlangt EventLoop auf dem Main-Thread).

mod common;

use app_lib::commands;
use common::{
    insert_test_haendler, insert_test_kasse_and_lauf, insert_test_kundenabrechnung,
    insert_test_kundenabrechnung_without_lauf, setup_test_app,
};

#[test]
#[cfg_attr(target_os = "macos", ignore = "Tauri EventLoop requires main thread; run on Linux/Windows or in CI")]
fn get_haendler_umsatz_returns_booking_with_abrechnungslauf_id() {
    let (_temp, _app, handle) = setup_test_app();
    let (kassen_id, lauf_id) = insert_test_kasse_and_lauf(&handle);
    insert_test_kundenabrechnung(&handle, &kassen_id, &lauf_id);

    let umsaetze = commands::get_haendler_umsatz(handle).expect("get_haendler_umsatz");
    assert_eq!(umsaetze.len(), 1);
    assert_eq!(umsaetze[0].haendlernummer, "H1");
    assert!((umsaetze[0].summe - 10.5).abs() < 1e-9);
    assert_eq!(umsaetze[0].anzahl, 1);
}

#[test]
#[cfg_attr(target_os = "macos", ignore = "Tauri EventLoop requires main thread; run on Linux/Windows or in CI")]
fn get_recent_abrechnungen_includes_booking_with_abrechnungslauf_id() {
    let (_temp, _app, handle) = setup_test_app();
    let (kassen_id, lauf_id) = insert_test_kasse_and_lauf(&handle);
    insert_test_kundenabrechnung(&handle, &kassen_id, &lauf_id);

    let list = commands::get_recent_abrechnungen(handle, 10).expect("get_recent_abrechnungen");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].kassen_id, kassen_id);
    assert!((list[0].summe - 10.5).abs() < 1e-9);
    assert_eq!(list[0].anzahl_positionen, 1);
}

#[test]
#[cfg_attr(target_os = "macos", ignore = "Tauri EventLoop requires main thread; run on Linux/Windows or in CI")]
fn storno_position_excludes_booking_from_get_haendler_umsatz() {
    let (_temp, _app, handle) = setup_test_app();
    let (kassen_id, lauf_id) = insert_test_kasse_and_lauf(&handle);
    let (_ka_id, buchung_id) = insert_test_kundenabrechnung(&handle, &kassen_id, &lauf_id);

    let umsaetze_before = commands::get_haendler_umsatz(handle.clone()).expect("get_haendler_umsatz");
    assert_eq!(umsaetze_before.len(), 1);

    commands::storno_position(handle.clone(), buchung_id).expect("storno_position");

    let umsaetze_after = commands::get_haendler_umsatz(handle).expect("get_haendler_umsatz");
    assert!(umsaetze_after.is_empty());
}

#[test]
#[cfg_attr(target_os = "macos", ignore = "Tauri EventLoop requires main thread; run on Linux/Windows or in CI")]
fn get_buchungen_for_abrechnung_returns_positionen() {
    let (_temp, _app, handle) = setup_test_app();
    let (kassen_id, lauf_id) = insert_test_kasse_and_lauf(&handle);
    let (ka_id, _buchung_id) = insert_test_kundenabrechnung(&handle, &kassen_id, &lauf_id);

    let buchungen = commands::get_buchungen_for_abrechnung(handle, ka_id).expect("get_buchungen_for_abrechnung");
    assert_eq!(buchungen.len(), 1);
    assert_eq!(buchungen[0].haendlernummer, "H1");
    assert!((buchungen[0].betrag - 10.5).abs() < 1e-9);
    assert!(!buchungen[0].ist_storniert);
}

#[test]
#[cfg_attr(target_os = "macos", ignore = "Tauri EventLoop requires main thread; run on Linux/Windows or in CI")]
fn get_buchungen_for_haendler_returns_bookings_in_active_lauf() {
    let (_temp, _app, handle) = setup_test_app();
    let (kassen_id, lauf_id) = insert_test_kasse_and_lauf(&handle);
    insert_test_kundenabrechnung(&handle, &kassen_id, &lauf_id);

    let buchungen = commands::get_buchungen_for_haendler(handle, "H1".to_string()).expect("get_buchungen_for_haendler");
    assert_eq!(buchungen.len(), 1);
    assert_eq!(buchungen[0].haendlernummer, "H1");
    assert!((buchungen[0].betrag - 10.5).abs() < 1e-9);
}

#[test]
#[cfg_attr(target_os = "macos", ignore = "Tauri EventLoop requires main thread; run on Linux/Windows or in CI")]
fn abrechnung_without_abrechnungslauf_id_does_not_appear_in_queries() {
    let (_temp, _app, handle) = setup_test_app();
    let (kassen_id, _lauf_id) = insert_test_kasse_and_lauf(&handle);
    insert_test_kundenabrechnung_without_lauf(&handle, &kassen_id);

    let umsaetze = commands::get_haendler_umsatz(handle.clone()).expect("get_haendler_umsatz");
    assert!(umsaetze.is_empty(), "Buchung ohne abrechnungslauf_id darf nicht in get_haendler_umsatz erscheinen");

    let list = commands::get_recent_abrechnungen(handle, 10).expect("get_recent_abrechnungen");
    assert!(list.is_empty(), "Kundenabrechnung ohne abrechnungslauf_id darf nicht in get_recent_abrechnungen erscheinen");
}

#[test]
#[cfg_attr(target_os = "macos", ignore = "Tauri EventLoop requires main thread; run on Linux/Windows or in CI")]
fn get_haendler_abrechnung_pdf_data_returns_summary_and_excludes_storno() {
    let (_temp, _app, handle) = setup_test_app();
    let (kassen_id, lauf_id) = insert_test_kasse_and_lauf(&handle);
    insert_test_haendler(&handle, "H1");
    let (_ka_id, buchung_id) = insert_test_kundenabrechnung(&handle, &kassen_id, &lauf_id);

    // Storno setzen -> Summe/Anzahl müssen 0 werden
    commands::storno_position(handle.clone(), buchung_id).expect("storno_position");

    let dto = commands::get_haendler_abrechnung_pdf_data(handle, "H1".to_string(), lauf_id)
        .expect("get_haendler_abrechnung_pdf_data");
    assert_eq!(dto.haendler.haendlernummer, "H1");
    assert_eq!(
        dto.haendler.email.as_deref(),
        Some("test@example.com"),
        "eMail muss aus Händler-Stammdaten kommen"
    );
    assert_eq!(dto.lauf.name, "Testlauf");
    assert!((dto.werte.summe - 0.0).abs() < 1e-9);
    assert_eq!(dto.werte.anzahl, 0);
}

#[test]
#[cfg_attr(target_os = "macos", ignore = "Tauri EventLoop requires main thread; run on Linux/Windows or in CI")]
fn get_haendler_abrechnung_pdf_data_returns_zero_when_no_bookings() {
    let (_temp, _app, handle) = setup_test_app();
    let (_kassen_id, lauf_id) = insert_test_kasse_and_lauf(&handle);
    insert_test_haendler(&handle, "H1");

    let dto = commands::get_haendler_abrechnung_pdf_data(handle, "H1".to_string(), lauf_id)
        .expect("get_haendler_abrechnung_pdf_data");
    assert!((dto.werte.summe - 0.0).abs() < 1e-9);
    assert_eq!(dto.werte.anzahl, 0);
}

#[test]
#[cfg_attr(target_os = "macos", ignore = "Tauri EventLoop requires main thread; run on Linux/Windows or in CI")]
fn get_haendler_abrechnung_pdf_data_errors_when_haendler_missing() {
    let (_temp, _app, handle) = setup_test_app();
    let (_kassen_id, lauf_id) = insert_test_kasse_and_lauf(&handle);
    let err = commands::get_haendler_abrechnung_pdf_data(handle, "H999".to_string(), lauf_id)
        .err()
        .expect("expected error");
    assert!(err.to_lowercase().contains("händler") || err.to_lowercase().contains("haendler"));
}

#[test]
#[cfg_attr(target_os = "macos", ignore = "Tauri EventLoop requires main thread; run on Linux/Windows or in CI")]
fn get_haendler_abrechnung_pdf_data_errors_when_lauf_missing() {
    let (_temp, _app, handle) = setup_test_app();
    insert_test_haendler(&handle, "H1");
    let err = commands::get_haendler_abrechnung_pdf_data(
        handle,
        "H1".to_string(),
        "missing-lauf".to_string(),
    )
    .err()
    .expect("expected error");
    assert!(err.to_lowercase().contains("abrechnungslauf"));
}
