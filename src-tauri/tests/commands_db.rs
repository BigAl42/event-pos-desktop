//! Integrationstests für DB-Commands: get_haendler_umsatz, get_recent_abrechnungen.
//! Ausführen mit: cargo test --features test
//! Hinweis: Tests, die die Tauri-App bauen, laufen nur auf Linux/Windows (macOS verlangt EventLoop auf dem Main-Thread).

mod common;

use app_lib::commands;
use common::{insert_test_kasse_and_lauf, insert_test_kundenabrechnung, setup_test_app};

#[test]
#[cfg_attr(target_os = "macos", ignore)]
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
#[cfg_attr(target_os = "macos", ignore)]
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
