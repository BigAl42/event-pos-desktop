//! DB-Zugriffe für Sync (Phase 3)

use crate::db;
use crate::sync::protocol::{
    AbrechnungslaufReset, BuchungRow, HaendlerInfo, KundenabrechnungBatch, KundenabrechnungItem,
    KundenabrechnungRow, StornoBatch, StornoRow,
};
use std::collections::HashMap;
use tauri::AppHandle;

/// Liefert den aktuellen Sync-Stand: kassen_id → max(sequence).
pub fn get_sync_state_map(app: &AppHandle) -> Result<HashMap<String, i64>, String> {
    let path = db::db_path(app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT kassen_id, MAX(sequence) as max_seq FROM kundenabrechnung GROUP BY kassen_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut map = HashMap::new();
    for row in rows {
        let (k, v) = row.map_err(|e| e.to_string())?;
        map.insert(k, v);
    }
    Ok(map)
}

/// Liefert alle Kundenabrechnungen einer Kasse mit sequence > after_sequence inkl. Buchungen.
pub fn get_batch(
    app: &AppHandle,
    kassen_id: &str,
    after_sequence: i64,
) -> Result<KundenabrechnungBatch, String> {
    let path = db::db_path(app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;

    // Aktiven Abrechnungslauf bestimmen, damit Batches nicht laufübergreifend gemischt werden
    let mut lauf_stmt = conn
        .prepare(
            "SELECT id FROM abrechnungslauf WHERE is_aktiv = 1 LIMIT 1",
        )
        .map_err(|e| e.to_string())?;
    let mut lauf_rows = lauf_stmt.query([]).map_err(|e| e.to_string())?;
    let lauf_id_opt: Option<String> = if let Some(row) = lauf_rows.next().map_err(|e| e.to_string())? {
        Some(row.get(0).map_err(|e| e.to_string())?)
    } else {
        None
    };

    let mut stmt = conn
        .prepare(
            "SELECT id, kassen_id, person1_name, person2_name, zeitstempel, belegnummer, sequence
             FROM kundenabrechnung
             WHERE kassen_id = ?1 AND sequence > ?2
             ORDER BY sequence",
        )
        .map_err(|e| e.to_string())?;
    let ka_rows = stmt
        .query_map(rusqlite::params![kassen_id, after_sequence], |row| {
            Ok(KundenabrechnungRow {
                id: row.get(0)?,
                kassen_id: row.get(1)?,
                person1_name: row.get(2)?,
                person2_name: row.get(3)?,
                zeitstempel: row.get(4)?,
                belegnummer: row.get(5)?,
                sequence: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let kundenabrechnungen: Vec<KundenabrechnungRow> = ka_rows.filter_map(|r| r.ok()).collect();

    let mut items = Vec::new();
    for ka in kundenabrechnungen {
        let mut buch_stmt = conn
            .prepare(
                "SELECT id, kundenabrechnung_id, haendlernummer, betrag, bezeichnung
                 FROM buchungen WHERE kundenabrechnung_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let buch_rows = buch_stmt
            .query_map(rusqlite::params![&ka.id], |row| {
                Ok(BuchungRow {
                    id: row.get(0)?,
                    kundenabrechnung_id: row.get(1)?,
                    haendlernummer: row.get(2)?,
                    betrag: row.get(3)?,
                    bezeichnung: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let buchungen: Vec<BuchungRow> = buch_rows.filter_map(|r| r.ok()).collect();
        items.push(KundenabrechnungItem {
            kundenabrechnung: ka,
            buchungen,
        });
    }
    Ok(KundenabrechnungBatch {
        items,
        abrechnungslauf_id: lauf_id_opt,
    })
}

/// Fügt Kundenabrechnungen und Buchungen ein (ON CONFLICT DO NOTHING). Aktualisiert sync_state für die Quell-Kasse.
pub fn apply_batch(
    app: &AppHandle,
    peer_kassen_id: &str,
    batch: &KundenabrechnungBatch,
) -> Result<i64, String> {
    if batch.items.is_empty() {
        return Ok(0);
    }
    let path = db::db_path(app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;

    // Sicherstellen, dass wir nur Daten für den aktuellen Abrechnungslauf übernehmen
    let mut lauf_stmt = conn
        .prepare("SELECT id FROM abrechnungslauf WHERE is_aktiv = 1 LIMIT 1")
        .map_err(|e| e.to_string())?;
    let mut lauf_rows = lauf_stmt.query([]).map_err(|e| e.to_string())?;
    let current_lauf_id_opt: Option<String> =
        if let Some(row) = lauf_rows.next().map_err(|e| e.to_string())? {
            Some(row.get(0).map_err(|e| e.to_string())?)
        } else {
            None
        };

    if let Some(batch_lauf_id) = &batch.abrechnungslauf_id {
        if let Some(ref current_id) = current_lauf_id_opt {
            if current_id != batch_lauf_id {
                return Err(
                    "Sync-Batch gehört zu einem anderen Abrechnungslauf. Bitte Laufzustände prüfen."
                        .to_string(),
                );
            }
        }
    }

    let lauf_id_to_use: String = match (&batch.abrechnungslauf_id, &current_lauf_id_opt) {
        (Some(batch_id), _) => batch_id.clone(),
        (None, Some(current_id)) => current_id.clone(),
        (None, None) => "initial".to_string(),
    };

    let mut max_seq: i64 = 0;
    for item in &batch.items {
        let ka = &item.kundenabrechnung;
        conn.execute(
            "INSERT OR IGNORE INTO kundenabrechnung (id, kassen_id, person1_name, person2_name, zeitstempel, belegnummer, sequence, abrechnungslauf_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                &ka.id,
                &ka.kassen_id,
                ka.person1_name.as_deref(),
                ka.person2_name.as_deref(),
                &ka.zeitstempel,
                ka.belegnummer.as_deref(),
                ka.sequence,
                &lauf_id_to_use,
            ],
        )
        .map_err(|e| e.to_string())?;
        if ka.sequence > max_seq {
            max_seq = ka.sequence;
        }
        for b in &item.buchungen {
            conn.execute(
                "INSERT OR IGNORE INTO buchungen (id, kundenabrechnung_id, haendlernummer, betrag, bezeichnung)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    &b.id,
                    &b.kundenabrechnung_id,
                    &b.haendlernummer,
                    b.betrag,
                    b.bezeichnung.as_deref(),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    conn.execute(
        "INSERT OR REPLACE INTO sync_state (peer_kassen_id, last_sequence, updated_at) VALUES (?1, ?2, datetime('now'))",
        rusqlite::params![peer_kassen_id, max_seq],
    )
    .map_err(|e| e.to_string())?;
    Ok(max_seq)
}

/// Ersetzt die lokale Händlerliste durch die vom Master gepushte Liste (HaendlerListUpdate).
pub fn apply_haendler_list(app: &AppHandle, haendler: &[HaendlerInfo]) -> Result<(), String> {
    let path = db::db_path(app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM haendler", [])
        .map_err(|e| e.to_string())?;
    for h in haendler {
        conn.execute(
            "INSERT INTO haendler (haendlernummer, name, sort, vorname, nachname, strasse, hausnummer, plz, stadt, email) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                &h.haendlernummer,
                &h.name,
                h.sort,
                &h.vorname,
                &h.nachname,
                &h.strasse,
                &h.hausnummer,
                &h.plz,
                &h.stadt,
                &h.email,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn get_max_storno_zeitstempel_for_kasse(
    app: &AppHandle,
    kassen_id: &str,
) -> Result<Option<String>, String> {
    let path = db::db_path(app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    let ts: Option<String> = conn
        .query_row(
            "SELECT MAX(zeitstempel) FROM stornos WHERE kassen_id = ?1",
            rusqlite::params![kassen_id],
            |row| row.get(0),
        )
        .ok();
    Ok(ts)
}

/// Stornos die wir diesem Peer noch nicht geschickt haben (zeitstempel > last_sent_storno_zeitstempel).
pub fn get_stornos_to_send(app: &AppHandle, peer_kassen_id: &str) -> Result<StornoBatch, String> {
    let path = db::db_path(app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    let last_sent: Option<String> = conn
        .query_row(
            "SELECT last_sent_storno_zeitstempel FROM sync_state WHERE peer_kassen_id = ?1",
            rusqlite::params![peer_kassen_id],
            |row| row.get(0),
        )
        .ok();
    let stornos: Vec<StornoRow> = if let Some(ref since) = last_sent {
        let mut stmt = conn
            .prepare("SELECT id, buchung_id, kassen_id, zeitstempel, kundenabrechnung_id FROM stornos WHERE zeitstempel > ?1 ORDER BY zeitstempel")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![since], |row| {
                Ok(StornoRow {
                    id: row.get(0)?,
                    buchung_id: row.get(1)?,
                    kassen_id: row.get(2)?,
                    zeitstempel: row.get(3)?,
                    kundenabrechnung_id: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    } else {
        let mut stmt = conn
            .prepare("SELECT id, buchung_id, kassen_id, zeitstempel, kundenabrechnung_id FROM stornos ORDER BY zeitstempel")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(StornoRow {
                    id: row.get(0)?,
                    buchung_id: row.get(1)?,
                    kassen_id: row.get(2)?,
                    zeitstempel: row.get(3)?,
                    kundenabrechnung_id: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };
    Ok(StornoBatch { stornos })
}

/// Nach dem Senden von Stornos an einen Peer: last_sent_storno_zeitstempel setzen.
pub fn update_last_sent_storno(
    app: &AppHandle,
    peer_kassen_id: &str,
    max_zeitstempel: &str,
) -> Result<(), String> {
    let path = db::db_path(app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    // sync_state kann bei reinem Storno-Transfer noch fehlen (z.B. keine Kundenabrechnungs-Batches ausgetauscht).
    let _ = conn.execute(
        "INSERT OR IGNORE INTO sync_state (peer_kassen_id, last_sequence, updated_at) VALUES (?1, 0, datetime('now'))",
        rusqlite::params![peer_kassen_id],
    );
    conn.execute(
        "UPDATE sync_state SET last_sent_storno_zeitstempel = ?1 WHERE peer_kassen_id = ?2",
        rusqlite::params![max_zeitstempel, peer_kassen_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Stornos vom Peer anwenden (INSERT OR IGNORE).
pub fn apply_stornos(app: &AppHandle, batch: &StornoBatch) -> Result<(), String> {
    let path = db::db_path(app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    for s in &batch.stornos {
        conn.execute(
            "INSERT OR IGNORE INTO stornos (id, buchung_id, kassen_id, zeitstempel, kundenabrechnung_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                &s.id,
                &s.buchung_id,
                &s.kassen_id,
                &s.zeitstempel,
                s.kundenabrechnung_id.as_deref(),
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Abrechnungslauf-Reset vom Master anwenden: lokalen Lauf setzen und Bewegungsdaten leeren.
pub fn apply_abrechnungslauf_reset(
    app: &AppHandle,
    reset: &AbrechnungslaufReset,
) -> Result<(), String> {
    let path = db::db_path(app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM stornos", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM buchungen", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM kundenabrechnung", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sync_state", [])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM config WHERE key LIKE 'beleg_counter_%'",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE abrechnungslauf SET is_aktiv = 0 WHERE is_aktiv = 1",
        [],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO abrechnungslauf (id, name, start_zeitpunkt, end_zeitpunkt, is_aktiv) VALUES (?1, ?2, ?3, NULL, 1)",
        rusqlite::params![&reset.id, &reset.name, &reset.start_zeitpunkt],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
