//! Tauri-Commands für die App

use crate::db;
use crate::discovery;
use crate::sync::client;
use crate::sync::protocol::{HaendlerInfo, JoinApprove, Message, PeerInfo};
use crate::sync::server::{self, SyncConnectionsState};
use crate::sync::status::SyncStatusState;
use crate::sync::sync_db;
use mdns_sd::ServiceDaemon;
use rand::Rng;
use rusqlite::OptionalExtension;
use std::fs;
use std::sync::Mutex;
use std::io::Write;
use tauri::command;
use tauri::Emitter;
use tauri::Manager;
use tauri::State;

/// State für den Master-WebSocket-Server (approve_tx zum Senden von join_approve).
pub struct MasterServerState(pub Mutex<Option<server::ApproveSender>>);

/// State für den mDNS-Daemon (Master-Kasse hält ihn am Leben für Service-Ankündigung).
pub struct MdnsDaemonState(pub Mutex<Option<ServiceDaemon>>);

#[derive(Clone, serde::Serialize)]
pub struct SyncRuntimeStatus {
    pub started: bool,
    pub connected_peers: usize,
    pub started_at: Option<String>,
}

pub struct SyncRuntimeState(pub Mutex<SyncRuntimeStatus>);

impl Default for SyncRuntimeState {
    fn default() -> Self {
        Self(Mutex::new(SyncRuntimeStatus {
            started: false,
            connected_peers: 0,
            started_at: None,
        }))
    }
}

#[derive(serde::Serialize)]
pub struct AbrechnungslaufItem {
    pub id: String,
    pub name: String,
    pub start_zeitpunkt: String,
    pub end_zeitpunkt: Option<String>,
    pub is_aktiv: bool,
}

// ---------- Notfallmodus: Export/Import ----------

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct NotfallExportMeta {
    pub exported_lauf_id: String,
    pub exported_lauf_name: String,
    pub exported_lauf_start_zeitpunkt: String,
    pub exported_lauf_end_zeitpunkt: Option<String>,
    pub export_at: String,
    pub exporting_kasse_id: Option<String>,
    pub exporting_kasse_name: Option<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct NotfallKasseRow {
    pub id: String,
    pub name: String,
    pub is_master: i32,
    pub ws_url: Option<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct NotfallKundenabrechnungRow {
    pub id: String,
    pub kassen_id: String,
    pub person1_name: Option<String>,
    pub person2_name: Option<String>,
    pub zeitstempel: String,
    pub belegnummer: Option<String>,
    pub sequence: i64,
    pub abrechnungslauf_id: Option<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct NotfallBuchungRow {
    pub id: String,
    pub kundenabrechnung_id: String,
    pub haendlernummer: String,
    pub betrag: f64,
    pub bezeichnung: Option<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct NotfallStornoRow {
    pub id: String,
    pub buchung_id: String,
    pub kassen_id: String,
    pub zeitstempel: String,
    pub kundenabrechnung_id: Option<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct NotfallExportDto {
    pub meta: NotfallExportMeta,
    pub kassen: Vec<NotfallKasseRow>,
    pub kundenabrechnungen: Vec<NotfallKundenabrechnungRow>,
    pub buchungen: Vec<NotfallBuchungRow>,
    pub stornos: Vec<NotfallStornoRow>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct NotfallImportSummary {
    pub inserted_kassen: i64,
    pub ignored_kassen: i64,
    pub inserted_kundenabrechnungen: i64,
    pub ignored_kundenabrechnungen: i64,
    pub inserted_buchungen: i64,
    pub ignored_buchungen: i64,
    pub inserted_stornos: i64,
    pub ignored_stornos: i64,
}

fn get_aktiver_abrechnungslauf_id(conn: &rusqlite::Connection) -> Result<String, String> {
    let mut stmt = conn
        .prepare("SELECT id FROM abrechnungslauf WHERE is_aktiv = 1 LIMIT 1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let id: String = row.get(0).map_err(|e| e.to_string())?;
        Ok(id)
    } else {
        // Kein aktiver Lauf: Nur die Hauptkasse darf einmalig einen Default-Lauf anlegen.
        // Nebenkassen müssen ihren Lauf initial von der Hauptkasse erhalten (Join/Reset).
        let role: Option<String> = conn
            .query_row(
                "SELECT value FROM config WHERE key = 'role' LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if role.as_deref() != Some("master") {
            return Err(
                "Kein aktiver Abrechnungslauf vorhanden. Diese Nebenkasse muss zuerst von der Hauptkasse initialisiert werden."
                    .to_string(),
            );
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now()
            .format("%Y-%m-%dT%H:%M:%S%.fZ")
            .to_string();
        conn.execute(
            "INSERT INTO abrechnungslauf (id, name, start_zeitpunkt, end_zeitpunkt, is_aktiv) VALUES (?1, ?2, ?3, NULL, 1)",
            rusqlite::params![&id, "Neuer Lauf", &now],
        )
        .map_err(|e| e.to_string())?;
        Ok(id)
    }
}

#[command]
pub fn init_db(app: tauri::AppHandle) -> Result<String, String> {
    db::init_db(&app)
}

#[command]
pub fn get_notfall_export_data(
    app: tauri::AppHandle,
    abrechnungslauf_id: String,
) -> Result<NotfallExportDto, String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;

    // Lauf-Metadaten
    let (lauf_id, lauf_name, lauf_start, lauf_end): (String, String, String, Option<String>) = conn
        .query_row(
            "SELECT id, name, start_zeitpunkt, end_zeitpunkt FROM abrechnungslauf WHERE id = ?1 LIMIT 1",
            rusqlite::params![&abrechnungslauf_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|_| "Abrechnungslauf nicht gefunden.".to_string())?;

    let export_at = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.fZ")
        .to_string();
    let exporting_kasse_id = db::get_config(&app, "kassen_id").map_err(|e| e.to_string())?;
    let exporting_kasse_name = db::get_config(&app, "kassenname").map_err(|e| e.to_string())?;

    // Kassen (nur die, die in diesem Lauf tatsächlich vorkommen)
    let mut k_stmt = conn
        .prepare(
            "SELECT id, name, is_master, ws_url
             FROM kassen
             WHERE id IN (
               SELECT DISTINCT kassen_id FROM kundenabrechnung WHERE abrechnungslauf_id = ?1
             )
             ORDER BY name, id",
        )
        .map_err(|e| e.to_string())?;
    let k_rows = k_stmt
        .query_map(rusqlite::params![&lauf_id], |row| {
            Ok(NotfallKasseRow {
                id: row.get(0)?,
                name: row.get(1)?,
                is_master: row.get(2)?,
                ws_url: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let kassen: Vec<NotfallKasseRow> = k_rows.filter_map(|r| r.ok()).collect();

    // Kundenabrechnungen dieses Laufs
    let mut ka_stmt = conn
        .prepare(
            "SELECT id, kassen_id, person1_name, person2_name, zeitstempel, belegnummer, sequence, abrechnungslauf_id
             FROM kundenabrechnung
             WHERE abrechnungslauf_id = ?1
             ORDER BY zeitstempel, kassen_id, sequence",
        )
        .map_err(|e| e.to_string())?;
    let ka_rows = ka_stmt
        .query_map(rusqlite::params![&lauf_id], |row| {
            Ok(NotfallKundenabrechnungRow {
                id: row.get(0)?,
                kassen_id: row.get(1)?,
                person1_name: row.get(2)?,
                person2_name: row.get(3)?,
                zeitstempel: row.get(4)?,
                belegnummer: row.get(5)?,
                sequence: row.get(6)?,
                abrechnungslauf_id: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let kundenabrechnungen: Vec<NotfallKundenabrechnungRow> = ka_rows.filter_map(|r| r.ok()).collect();

    // Buchungen zu den Kundenabrechnungen dieses Laufs
    let mut b_stmt = conn
        .prepare(
            "SELECT b.id, b.kundenabrechnung_id, b.haendlernummer, b.betrag, b.bezeichnung
             FROM buchungen b
             JOIN kundenabrechnung ka ON ka.id = b.kundenabrechnung_id
             WHERE ka.abrechnungslauf_id = ?1
             ORDER BY b.kundenabrechnung_id, b.id",
        )
        .map_err(|e| e.to_string())?;
    let b_rows = b_stmt
        .query_map(rusqlite::params![&lauf_id], |row| {
            Ok(NotfallBuchungRow {
                id: row.get(0)?,
                kundenabrechnung_id: row.get(1)?,
                haendlernummer: row.get(2)?,
                betrag: row.get(3)?,
                bezeichnung: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let buchungen: Vec<NotfallBuchungRow> = b_rows.filter_map(|r| r.ok()).collect();

    // Stornos, die zu diesem Lauf gehören (via buchung_id oder kundenabrechnung_id)
    let mut s_stmt = conn
        .prepare(
            "SELECT s.id, s.buchung_id, s.kassen_id, s.zeitstempel, s.kundenabrechnung_id
             FROM stornos s
             WHERE s.buchung_id IN (
               SELECT b.id
               FROM buchungen b
               JOIN kundenabrechnung ka ON ka.id = b.kundenabrechnung_id
               WHERE ka.abrechnungslauf_id = ?1
             )
             OR s.kundenabrechnung_id IN (
               SELECT id FROM kundenabrechnung WHERE abrechnungslauf_id = ?1
             )
             ORDER BY s.zeitstempel, s.id",
        )
        .map_err(|e| e.to_string())?;
    let s_rows = s_stmt
        .query_map(rusqlite::params![&lauf_id], |row| {
            Ok(NotfallStornoRow {
                id: row.get(0)?,
                buchung_id: row.get(1)?,
                kassen_id: row.get(2)?,
                zeitstempel: row.get(3)?,
                kundenabrechnung_id: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let stornos: Vec<NotfallStornoRow> = s_rows.filter_map(|r| r.ok()).collect();

    Ok(NotfallExportDto {
        meta: NotfallExportMeta {
            exported_lauf_id: lauf_id,
            exported_lauf_name: lauf_name,
            exported_lauf_start_zeitpunkt: lauf_start,
            exported_lauf_end_zeitpunkt: lauf_end,
            export_at,
            exporting_kasse_id,
            exporting_kasse_name,
        },
        kassen,
        kundenabrechnungen,
        buchungen,
        stornos,
    })
}

#[command]
pub fn import_notfall_data(
    app: tauri::AppHandle,
    payload: NotfallExportDto,
    target_abrechnungslauf_id: String,
    allow_mismatch: bool,
) -> Result<NotfallImportSummary, String> {
    if !allow_mismatch && payload.meta.exported_lauf_id != target_abrechnungslauf_id {
        return Err(
            "Abrechnungslauf stimmt nicht überein (Export-Lauf != Ziel-Lauf). Import abgebrochen."
                .to_string(),
        );
    }

    let path = db::db_path(&app)?;
    let mut conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;

    // Sicherstellen, dass der Ziel-Lauf existiert (Import merged in diesen Lauf)
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM abrechnungslauf WHERE id = ?1",
            rusqlite::params![&target_abrechnungslauf_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists == 0 {
        return Err("Ziel-Abrechnungslauf nicht gefunden.".to_string());
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut summary = NotfallImportSummary {
        inserted_kassen: 0,
        ignored_kassen: 0,
        inserted_kundenabrechnungen: 0,
        ignored_kundenabrechnungen: 0,
        inserted_buchungen: 0,
        ignored_buchungen: 0,
        inserted_stornos: 0,
        ignored_stornos: 0,
    };

    for k in &payload.kassen {
        let n = tx
            .execute(
                "INSERT OR IGNORE INTO kassen (id, name, person1_name, person2_name, is_master, ws_url)
                 VALUES (?1, ?2, NULL, NULL, ?3, ?4)",
                rusqlite::params![&k.id, &k.name, k.is_master, &k.ws_url],
            )
            .map_err(|e| e.to_string())?;
        if n > 0 {
            summary.inserted_kassen += 1;
        } else {
            summary.ignored_kassen += 1;
        }
    }

    for ka in &payload.kundenabrechnungen {
        let n = tx
            .execute(
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
                    &target_abrechnungslauf_id,
                ],
            )
            .map_err(|e| e.to_string())?;
        if n > 0 {
            summary.inserted_kundenabrechnungen += 1;
        } else {
            summary.ignored_kundenabrechnungen += 1;
        }
    }

    for b in &payload.buchungen {
        let n = tx
            .execute(
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
        if n > 0 {
            summary.inserted_buchungen += 1;
        } else {
            summary.ignored_buchungen += 1;
        }
    }

    for s in &payload.stornos {
        let n = tx
            .execute(
                "INSERT OR IGNORE INTO stornos (id, buchung_id, kassen_id, zeitstempel, kundenabrechnung_id)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    &s.id,
                    &s.buchung_id,
                    &s.kassen_id,
                    &s.zeitstempel,
                    s.kundenabrechnung_id.as_deref(),
                ],
            )
            .map_err(|e| e.to_string())?;
        if n > 0 {
            summary.inserted_stornos += 1;
        } else {
            summary.ignored_stornos += 1;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(summary)
}

// ---------- Danger Zone: Lokale Daten komplett löschen ----------

/// Löscht die gesamte lokale Datenbasis dieser Kasse (DB + lokale Artefakte im App-Datenordner der Instanz).
/// Danach erscheint beim nächsten Start wieder der Erststart-Dialog.
#[command]
pub fn wipe_local_data(app: tauri::AppHandle) -> Result<(), String> {
    let dir = db::instance_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
        } else {
            match fs::remove_file(&path) {
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.to_string()),
            }
        }
    }
    Ok(())
}

// ---------- Join-Token (Master) ----------

#[command]
pub fn get_join_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
    db::get_config(&app, "join_token")
}

#[command]
pub fn generate_join_token(app: tauri::AppHandle) -> Result<String, String> {
    let code: u32 = rand::thread_rng().gen_range(100_000..1_000_000);
    let token = format!("{:06}", code);
    db::set_config(&app, "join_token", &token)?;
    Ok(token)
}

// ---------- Master WebSocket-Server ----------

#[command]
pub async fn start_master_server(app: tauri::AppHandle, port: u16) -> Result<(), String> {
    let approve_tx = server::start_ws_server(app.clone(), port).await?;
    if let Some(kassen_id) = db::get_config(&app, "kassen_id").map_err(|e| e.to_string())? {
        if let Some(my_ws_url) = db::get_config(&app, "my_ws_url").map_err(|e| e.to_string())? {
            let path = db::db_path(&app)?;
            let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE kassen SET ws_url = ?1 WHERE id = ?2",
                rusqlite::params![&my_ws_url, &kassen_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    app.state::<MasterServerState>()
        .0
        .lock()
        .map_err(|e: std::sync::PoisonError<_>| e.to_string())?
        .replace(approve_tx);

    // mDNS: Hauptkasse im LAN ankündigen, damit Nebenkassen sie finden
    let instance_name = db::get_config(&app, "kassenname")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "Kassensystem Hauptkasse".to_string());
    let mdns = ServiceDaemon::new().map_err(|e| e.to_string())?;
    discovery::register_master(&mdns, port, &instance_name)?;
    app.state::<MdnsDaemonState>()
        .0
        .lock()
        .map_err(|e: std::sync::PoisonError<_>| e.to_string())?
        .replace(mdns);

    Ok(())
}

/// Gibt true zurück, wenn der Master-WebSocket-Server gestartet wurde („Server starten“ war erfolgreich).
#[command]
pub fn is_master_server_running(state: State<MasterServerState>) -> bool {
    state.0.lock().map(|g| g.is_some()).unwrap_or(false)
}

// ---------- Join-Anfragen (Master) ----------

#[derive(serde::Serialize)]
pub struct JoinRequestItem {
    pub id: String,
    pub kassen_id: String,
    pub name: String,
    pub my_ws_url: Option<String>,
    pub status: String,
    pub created_at: String,
}

#[command]
pub fn get_join_requests(app: tauri::AppHandle) -> Result<Vec<JoinRequestItem>, String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, kassen_id, name, my_ws_url, status, created_at FROM join_requests WHERE status = 'pending' ORDER BY created_at",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(JoinRequestItem {
                id: row.get(0)?,
                kassen_id: row.get(1)?,
                name: row.get(2)?,
                my_ws_url: row.get(3)?,
                status: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let list: Vec<JoinRequestItem> = rows.filter_map(|r| r.ok()).collect();
    Ok(list)
}

#[command]
pub fn approve_join_request(
    app: tauri::AppHandle,
    state: State<MasterServerState>,
    kassen_id: String,
) -> Result<(), String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;

    let (name, my_ws_url): (String, Option<String>) = conn
        .query_row(
            "SELECT name, my_ws_url FROM join_requests WHERE kassen_id = ?1 AND status = 'pending'",
            rusqlite::params![&kassen_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "Join-Anfrage nicht gefunden oder bereits bearbeitet")?;

    let ws_url = my_ws_url.unwrap_or_default();

    conn.execute(
        "INSERT OR REPLACE INTO kassen (id, name, person1_name, person2_name, is_master, ws_url) VALUES (?1, ?2, NULL, NULL, 0, ?3)",
        rusqlite::params![&kassen_id, &name, &ws_url],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE join_requests SET status = 'approved' WHERE kassen_id = ?1",
        rusqlite::params![&kassen_id],
    )
    .map_err(|e| e.to_string())?;

    // Peer-Liste: alle Kassen inkl. Master mit ws_url
    let mut peer_stmt = conn
        .prepare("SELECT id, name, ws_url FROM kassen WHERE ws_url IS NOT NULL AND ws_url != ''")
        .map_err(|e| e.to_string())?;
    let peer_rows = peer_stmt
        .query_map([], |row| {
            Ok(PeerInfo {
                kassen_id: row.get(0)?,
                name: row.get(1)?,
                ws_url: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let peers: Vec<PeerInfo> = peer_rows.filter_map(|r| r.ok()).collect();

    // Händlerliste
    let mut haendler_stmt = conn.prepare(HAENDLER_SELECT).map_err(|e| e.to_string())?;
    let haendler_rows = haendler_stmt
        .query_map([], |row| {
            Ok(HaendlerInfo {
                haendlernummer: row.get(0)?,
                name: row.get(1)?,
                sort: row.get(2)?,
                vorname: row.get(3)?,
                nachname: row.get(4)?,
                strasse: row.get(5)?,
                hausnummer: row.get(6)?,
                plz: row.get(7)?,
                stadt: row.get(8)?,
                email: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let haendler: Vec<HaendlerInfo> = haendler_rows.filter_map(|r| r.ok()).collect();

    // Aktiven Abrechnungslauf für den Verbund ermitteln
    let mut lauf_stmt = conn
        .prepare(
            "SELECT id, name, start_zeitpunkt
             FROM abrechnungslauf
             WHERE is_aktiv = 1
             LIMIT 1",
        )
        .map_err(|e| e.to_string())?;
    let mut lauf_rows = lauf_stmt.query([]).map_err(|e| e.to_string())?;
    let (lauf_id_opt, lauf_name_opt, lauf_start_opt): (Option<String>, Option<String>, Option<String>) =
        if let Some(row) = lauf_rows.next().map_err(|e| e.to_string())? {
            let id: String = row.get(0).map_err(|e| e.to_string())?;
            let name: String = row.get(1).map_err(|e| e.to_string())?;
            let start: String = row.get(2).map_err(|e| e.to_string())?;
            (Some(id), Some(name), Some(start))
        } else {
            (None, None, None)
        };

    let msg = Message::JoinApprove(JoinApprove {
        peers,
        haendler,
        active_abrechnungslauf_id: lauf_id_opt,
        active_abrechnungslauf_name: lauf_name_opt,
        active_abrechnungslauf_start: lauf_start_opt,
    });
    let guard = state
        .0
        .lock()
        .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
    if let Some(ref tx) = *guard {
        server::send_join_approve(tx, &kassen_id, msg);
    }

    Ok(())
}

#[command]
pub fn reject_join_request(app: tauri::AppHandle, kassen_id: String) -> Result<(), String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE join_requests SET status = 'rejected' WHERE kassen_id = ?1",
        rusqlite::params![&kassen_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Händler CRUD ----------

#[derive(serde::Serialize)]
pub struct HaendlerItem {
    pub haendlernummer: String,
    pub name: String,
    pub sort: Option<i32>,
    pub vorname: Option<String>,
    pub nachname: Option<String>,
    pub strasse: Option<String>,
    pub hausnummer: Option<String>,
    pub plz: Option<String>,
    pub stadt: Option<String>,
    pub email: Option<String>,
}

const HAENDLER_SELECT: &str = "SELECT haendlernummer, name, sort, vorname, nachname, strasse, hausnummer, plz, stadt, email FROM haendler ORDER BY sort, haendlernummer";

#[command]
pub fn get_haendler_list(app: tauri::AppHandle) -> Result<Vec<HaendlerItem>, String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(HAENDLER_SELECT).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(HaendlerItem {
                haendlernummer: row.get(0)?,
                name: row.get(1)?,
                sort: row.get(2)?,
                vorname: row.get(3)?,
                nachname: row.get(4)?,
                strasse: row.get(5)?,
                hausnummer: row.get(6)?,
                plz: row.get(7)?,
                stadt: row.get(8)?,
                email: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn get_haendler_list_for_sync(app: &tauri::AppHandle) -> Result<Vec<HaendlerInfo>, String> {
    let path = db::db_path(app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(HAENDLER_SELECT).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(HaendlerInfo {
                haendlernummer: row.get(0)?,
                name: row.get(1)?,
                sort: row.get(2)?,
                vorname: row.get(3)?,
                nachname: row.get(4)?,
                strasse: row.get(5)?,
                hausnummer: row.get(6)?,
                plz: row.get(7)?,
                stadt: row.get(8)?,
                email: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[command]
pub fn create_haendler(
    app: tauri::AppHandle,
    haendlernummer: String,
    name: String,
    sort: Option<i32>,
    vorname: Option<String>,
    nachname: Option<String>,
    strasse: Option<String>,
    hausnummer: Option<String>,
    plz: Option<String>,
    stadt: Option<String>,
    email: Option<String>,
) -> Result<(), String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO haendler (haendlernummer, name, sort, vorname, nachname, strasse, hausnummer, plz, stadt, email) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            &haendlernummer,
            &name,
            sort,
            &vorname,
            &nachname,
            &strasse,
            &hausnummer,
            &plz,
            &stadt,
            &email,
        ],
    )
    .map_err(|e| e.to_string())?;
    if db::get_config(&app, "role")
        .map_err(|e| e.to_string())?
        .as_deref()
        == Some("master")
    {
        if let Ok(list) = get_haendler_list_for_sync(&app) {
            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = server::broadcast_haendler_list(&app_clone, list).await;
            });
        }
    }
    Ok(())
}

#[command]
pub fn update_haendler(
    app: tauri::AppHandle,
    haendlernummer: String,
    name: String,
    sort: Option<i32>,
    vorname: Option<String>,
    nachname: Option<String>,
    strasse: Option<String>,
    hausnummer: Option<String>,
    plz: Option<String>,
    stadt: Option<String>,
    email: Option<String>,
) -> Result<(), String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE haendler SET name = ?1, sort = ?2, vorname = ?3, nachname = ?4, strasse = ?5, hausnummer = ?6, plz = ?7, stadt = ?8, email = ?9 WHERE haendlernummer = ?10",
        rusqlite::params![
            &name,
            sort,
            &vorname,
            &nachname,
            &strasse,
            &hausnummer,
            &plz,
            &stadt,
            &email,
            &haendlernummer,
        ],
    )
    .map_err(|e| e.to_string())?;
    if db::get_config(&app, "role")
        .map_err(|e| e.to_string())?
        .as_deref()
        == Some("master")
    {
        if let Ok(list) = get_haendler_list_for_sync(&app) {
            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = server::broadcast_haendler_list(&app_clone, list).await;
            });
        }
    }
    Ok(())
}

#[command]
pub fn delete_haendler(app: tauri::AppHandle, haendlernummer: String) -> Result<(), String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM haendler WHERE haendlernummer = ?1",
        rusqlite::params![&haendlernummer],
    )
    .map_err(|e| e.to_string())?;
    if db::get_config(&app, "role")
        .map_err(|e| e.to_string())?
        .as_deref()
        == Some("master")
    {
        if let Ok(list) = get_haendler_list_for_sync(&app) {
            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = server::broadcast_haendler_list(&app_clone, list).await;
            });
        }
    }
    Ok(())
}

// ---------- Join-Netzwerk (Nebenkasse) ----------

#[command]
pub async fn join_network(app: tauri::AppHandle, token: String) -> Result<String, String> {
    let master_url = db::get_config(&app, "master_ws_url")
        .map_err(|e| e.to_string())?
        .ok_or("Hauptkassen-URL nicht konfiguriert (Einstellungen)")?;
    let kassen_id = db::get_config(&app, "kassen_id")
        .map_err(|e| e.to_string())?
        .ok_or("Kassen-ID nicht gesetzt")?;
    let name = db::get_config(&app, "kassenname")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "Kasse".to_string());
    let my_ws_url = db::get_config(&app, "my_ws_url")
        .map_err(|e| e.to_string())?
        .ok_or("Eigene Sync-URL nicht konfiguriert (Einstellungen)")?;

    let approve =
        client::send_join_request(&master_url, &kassen_id, &name, &my_ws_url, token.trim()).await?;

    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;

    // Prüfen, ob bereits lokale Bewegungsdaten existieren
    let mut count_stmt = conn
        .prepare("SELECT COUNT(*) FROM kundenabrechnung")
        .map_err(|e| e.to_string())?;
    let existing_count: i64 = count_stmt
        .query_row([], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if existing_count > 0 {
        let master_lauf_id = approve.active_abrechnungslauf_id.clone().ok_or_else(|| {
            "Join nicht möglich: Hauptkasse hat keinen aktiven Abrechnungslauf übertragen."
                .to_string()
        })?;

        let local_lauf_id_opt: Option<String> = conn
            .query_row(
                "SELECT id FROM abrechnungslauf WHERE is_aktiv = 1 LIMIT 1",
                [],
                |row| row.get(0),
            )
            .ok();

        if let Some(local_lauf_id) = local_lauf_id_opt {
            if local_lauf_id != master_lauf_id {
                return Err(format!(
                    "Join nicht möglich: Nebenkasse hat bereits lokale Buchungen im Abrechnungslauf {} (lokal aktiv), die Hauptkasse ist im Abrechnungslauf {}. Bitte Abrechnungsläufe angleichen (z.B. Reset) und erneut versuchen.",
                    local_lauf_id, master_lauf_id
                ));
            }
        } else {
            return Err(
                "Join nicht möglich: Nebenkasse hat bereits lokale Buchungen, aber keinen aktiven Abrechnungslauf. Bitte Abrechnungslauf prüfen/angleichen (z.B. Reset) und erneut versuchen."
                    .to_string(),
            );
        }
    }

    // Aktiven Abrechnungslauf des Masters lokal übernehmen (falls mitgeliefert)
    if let Some(lauf_id) = &approve.active_abrechnungslauf_id {
        let lauf_name = approve
            .active_abrechnungslauf_name
            .clone()
            .unwrap_or_else(|| "Master-Abrechnungslauf".to_string());
        let lauf_start = approve
            .active_abrechnungslauf_start
            .clone()
            .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.fZ").to_string());

        conn.execute(
            "UPDATE abrechnungslauf SET is_aktiv = 0 WHERE is_aktiv = 1",
            [],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO abrechnungslauf (id, name, start_zeitpunkt, end_zeitpunkt, is_aktiv) VALUES (?1, ?2, ?3, NULL, 1)",
            rusqlite::params![lauf_id, &lauf_name, &lauf_start],
        )
        .map_err(|e| e.to_string())?;
    }

    for peer in &approve.peers {
        conn.execute(
            "INSERT OR REPLACE INTO kassen (id, name, person1_name, person2_name, is_master, ws_url) VALUES (?1, ?2, NULL, NULL, 0, ?3)",
            rusqlite::params![&peer.kassen_id, &peer.name, &peer.ws_url],
        )
        .map_err(|e| e.to_string())?;
    }

    db::set_config(&app, "initialized_from_master", "true").map_err(|e| e.to_string())?;

    // Sync-State zurücksetzen, damit vorhandene lokale Buchungen (sequence) sicher nachgesendet werden
    // (und nicht fälschlich als "schon gesynct" gelten).
    conn.execute("DELETE FROM sync_state", [])
        .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM haendler", [])
        .map_err(|e| e.to_string())?;
    for h in &approve.haendler {
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

    let _ = app.emit("sync-data-changed", ());
    Ok("Netz beigetreten. Peer-, Händler- und Abrechnungslaufdaten übernommen.".to_string())
}

/// Nebenkasse: Fordert bei der Hauptkasse einen Reset des lokalen Abrechnungslaufs an.
/// Die Hauptkasse prüft, ob alle Daten der Nebenkasse angekommen sind; wenn ja, wird AbrechnungslaufReset gesendet und hier angewendet.
#[command]
pub async fn request_slave_reset(app: tauri::AppHandle) -> Result<String, String> {
    let master_url = db::get_config(&app, "master_ws_url")
        .map_err(|e| e.to_string())?
        .ok_or("Hauptkassen-URL nicht konfiguriert (Einstellungen)")?;
    let kassen_id = db::get_config(&app, "kassen_id")
        .map_err(|e| e.to_string())?
        .ok_or("Kassen-ID nicht gesetzt")?;

    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    let max_sequence: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sequence), 0) FROM kundenabrechnung WHERE kassen_id = ?1",
            rusqlite::params![&kassen_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let reset = client::send_slave_reset_request(&master_url, &kassen_id, max_sequence).await?;
    sync_db::apply_abrechnungslauf_reset(&app, &reset).map_err(|e| e.to_string())?;
    let _ = app.emit("sync-data-changed", ());
    Ok("Lokaler Abrechnungslauf wurde geleert und mit dem Abrechnungslauf der Hauptkasse abgeglichen.".to_string())
}

/// Nebenkasse: Fordert bei der Hauptkasse eine Closeout-Bestätigung an („Abmelden/Lauf fertig“).
/// Die Hauptkasse bestätigt, dass alle Buchungen und Stornos dieser Nebenkasse angekommen sind.
#[command]
pub async fn request_closeout(app: tauri::AppHandle) -> Result<String, String> {
    let master_url = db::get_config(&app, "master_ws_url")
        .map_err(|e| e.to_string())?
        .ok_or("Hauptkassen-URL nicht konfiguriert (Einstellungen)")?;
    let kassen_id = db::get_config(&app, "kassen_id")
        .map_err(|e| e.to_string())?
        .ok_or("Kassen-ID nicht gesetzt")?;

    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    let max_sequence: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sequence), 0) FROM kundenabrechnung WHERE kassen_id = ?1",
            rusqlite::params![&kassen_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let max_storno_zeitstempel: Option<String> = conn
        .query_row(
            "SELECT MAX(zeitstempel) FROM stornos WHERE kassen_id = ?1",
            rusqlite::params![&kassen_id],
            |row| row.get(0),
        )
        .ok();

    let approve =
        client::send_closeout_request(&master_url, &kassen_id, max_sequence, max_storno_zeitstempel)
            .await?;

    if let Some(ref lauf_id) = approve.active_abrechnungslauf_id {
        db::set_config(&app, "closeout_ok_for_lauf_id", lauf_id).map_err(|e| e.to_string())?;
    } else {
        db::set_config(&app, "closeout_ok_for_lauf_id", "").map_err(|e| e.to_string())?;
    }
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.fZ")
        .to_string();
    db::set_config(&app, "closeout_ok_at", &now).map_err(|e| e.to_string())?;

    Ok("Closeout bestätigt: Hauptkasse hat alle Daten dieser Kasse. Abmelden ist möglich.".to_string())
}

/// Nebenkasse: Entkoppelt diese Kasse lokal vom Netzwerk (vergisst Master/Peers).
/// Hinweis: Laufende Sync-Tasks werden nicht hart gestoppt; nach Entkoppeln sollte Sync nicht erneut gestartet werden.
#[command]
pub fn leave_network(app: tauri::AppHandle) -> Result<String, String> {
    let role = db::get_config(&app, "role")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    if role != "slave" {
        return Err("Entkoppeln ist nur auf Nebenkassen möglich.".to_string());
    }
    let master_url_opt = db::get_config(&app, "master_ws_url").map_err(|e| e.to_string())?;
    let my_kassen_id = db::get_config(&app, "kassen_id")
        .map_err(|e| e.to_string())?
        .ok_or("Kassen-ID nicht gesetzt")?;

    // Best-effort: Hauptkasse informieren, damit diese Kasse aus der Peer-Liste verschwindet.
    if let Some(master_url) = master_url_opt.as_deref() {
        if !master_url.trim().is_empty() {
            let master_url = master_url.to_string();
            let kassen_id = my_kassen_id.clone();
            tauri::async_runtime::spawn(async move {
                let _ = client::send_leave_network_request(&master_url, &kassen_id).await;
            });
        }
    }

    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE kassen SET ws_url = NULL WHERE id != ?1",
        rusqlite::params![&my_kassen_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sync_state", [])
        .map_err(|e| e.to_string())?;

    db::set_config(&app, "master_ws_url", "").map_err(|e| e.to_string())?;
    db::set_config(&app, "initialized_from_master", "false").map_err(|e| e.to_string())?;
    db::set_config(&app, "closeout_ok_for_lauf_id", "").map_err(|e| e.to_string())?;
    db::set_config(&app, "closeout_ok_at", "").map_err(|e| e.to_string())?;

    let _ = app.emit("sync-data-changed", ());
    Ok("Nebenkasse wurde lokal entkoppelt (Master/Peers vergessen).".to_string())
}

// ---------- Phase 4: Storno ----------

#[command]
pub fn storno_position(app: tauri::AppHandle, buchung_id: String) -> Result<(), String> {
    let kassen_id = db::get_config(&app, "kassen_id")
        .map_err(|e| e.to_string())?
        .ok_or("Kassen-ID nicht gesetzt")?;
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.fZ")
        .to_string();
    conn.execute(
        "INSERT INTO stornos (id, buchung_id, kassen_id, zeitstempel) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![&id, &buchung_id, &kassen_id, &now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub fn storno_abrechnung(app: tauri::AppHandle, kundenabrechnung_id: String) -> Result<(), String> {
    let kassen_id = db::get_config(&app, "kassen_id")
        .map_err(|e| e.to_string())?
        .ok_or("Kassen-ID nicht gesetzt")?;
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.fZ")
        .to_string();
    let mut stmt = conn
        .prepare("SELECT id FROM buchungen WHERE kundenabrechnung_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![&kundenabrechnung_id], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let buchung_id: String = row.map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO stornos (id, buchung_id, kassen_id, zeitstempel, kundenabrechnung_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![&id, &buchung_id, &kassen_id, &now, &kundenabrechnung_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct KundenabrechnungListItem {
    pub id: String,
    pub belegnummer: Option<String>,
    pub zeitstempel: String,
    pub kassen_id: String,
    pub kassen_name: Option<String>,
    pub summe: f64,
    pub anzahl_positionen: i64,
}

#[command]
pub fn get_recent_abrechnungen(
    app: tauri::AppHandle,
    limit: i32,
) -> Result<Vec<KundenabrechnungListItem>, String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    let lauf_id = get_aktiver_abrechnungslauf_id(&conn)?;
    let limit = limit.max(1).min(100);
    let mut stmt = conn
        .prepare(
            "SELECT ka.id, ka.belegnummer, ka.zeitstempel, ka.kassen_id, k.name as kassen_name,
                    COALESCE(SUM(b.betrag), 0) as summe, COUNT(b.id) as anzahl
             FROM kundenabrechnung ka
             LEFT JOIN kassen k ON ka.kassen_id = k.id
             LEFT JOIN buchungen b ON b.kundenabrechnung_id = ka.id AND b.id NOT IN (SELECT buchung_id FROM stornos)
             WHERE ka.abrechnungslauf_id = ?2
             GROUP BY ka.id
             ORDER BY ka.zeitstempel DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![limit, &lauf_id], |row| {
            Ok(KundenabrechnungListItem {
                id: row.get(0)?,
                belegnummer: row.get(1)?,
                zeitstempel: row.get(2)?,
                kassen_id: row.get(3)?,
                kassen_name: row.get(4)?,
                summe: row.get(5)?,
                anzahl_positionen: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[derive(serde::Serialize)]
pub struct BuchungListItem {
    pub id: String,
    pub haendlernummer: String,
    pub betrag: f64,
    pub bezeichnung: Option<String>,
    pub ist_storniert: bool,
}

#[command]
pub fn get_buchungen_for_abrechnung(
    app: tauri::AppHandle,
    kundenabrechnung_id: String,
) -> Result<Vec<BuchungListItem>, String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT b.id, b.haendlernummer, b.betrag, b.bezeichnung,
                    (SELECT 1 FROM stornos s WHERE s.buchung_id = b.id LIMIT 1) IS NOT NULL as ist_storniert
             FROM buchungen b
             WHERE b.kundenabrechnung_id = ?1
             ORDER BY b.haendlernummer, b.betrag",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![&kundenabrechnung_id], |row| {
            Ok(BuchungListItem {
                id: row.get(0)?,
                haendlernummer: row.get(1)?,
                betrag: row.get(2)?,
                bezeichnung: row.get(3)?,
                ist_storniert: row.get::<_, i32>(4)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

// ---------- Händler-Umsatz & Drilldown ----------

#[derive(serde::Serialize)]
pub struct HaendlerUmsatzItem {
    pub haendlernummer: String,
    pub summe: f64,
    pub anzahl: i64,
}

/// Aggregierte Umsätze pro Händlernummer für den aktuellen Abrechnungslauf.
///
/// Hinweis: Der „aktuelle Kassentag“ entspricht hier dem aktuellen Abrechnungslauf.
/// Dieser wird über `reset_abrechnungslauf` zurückgesetzt (Buchungen/Kundenabrechnungen werden geleert).
#[command]
pub fn get_haendler_umsatz(app: tauri::AppHandle) -> Result<Vec<HaendlerUmsatzItem>, String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    let lauf_id = get_aktiver_abrechnungslauf_id(&conn)?;
    let mut stmt = conn
        .prepare(
            "SELECT b.haendlernummer, COALESCE(SUM(b.betrag), 0) as summe, COUNT(*) as anzahl
             FROM buchungen b
             JOIN kundenabrechnung ka ON b.kundenabrechnung_id = ka.id
             WHERE b.id NOT IN (SELECT buchung_id FROM stornos)
               AND ka.abrechnungslauf_id = ?1
             GROUP BY b.haendlernummer
             ORDER BY b.haendlernummer",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![&lauf_id], |row| {
            Ok(HaendlerUmsatzItem {
                haendlernummer: row.get(0)?,
                summe: row.get(1)?,
                anzahl: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[derive(serde::Serialize)]
pub struct HaendlerBuchungItem {
    pub id: String,
    pub haendlernummer: String,
    pub betrag: f64,
    pub bezeichnung: Option<String>,
    pub zeitstempel: String,
    pub kassen_id: String,
    pub kassen_name: Option<String>,
    pub ist_storniert: bool,
}

// ---------- PDF-Abrechnung (Händler, 1 Seite) ----------

#[derive(serde::Serialize)]
pub struct HaendlerAbrechnungPdfHaendler {
    pub haendlernummer: String,
    pub name: String,
    pub vorname: Option<String>,
    pub nachname: Option<String>,
    pub strasse: Option<String>,
    pub hausnummer: Option<String>,
    pub plz: Option<String>,
    pub stadt: Option<String>,
    pub email: Option<String>,
}

#[derive(serde::Serialize)]
pub struct HaendlerAbrechnungPdfLauf {
    pub id: String,
    pub name: String,
    pub start_zeitpunkt: String,
    pub end_zeitpunkt: Option<String>,
}

#[derive(serde::Serialize)]
pub struct HaendlerAbrechnungPdfWerte {
    pub summe: f64,
    pub anzahl: i64,
}

#[derive(serde::Serialize)]
pub struct HaendlerAbrechnungPdfData {
    pub haendler: HaendlerAbrechnungPdfHaendler,
    pub lauf: HaendlerAbrechnungPdfLauf,
    pub werte: HaendlerAbrechnungPdfWerte,
}

/// Datenbasis für eine 1-seitige Händler-Abrechnung (PDF) für einen spezifischen Abrechnungslauf.
#[command]
pub fn get_haendler_abrechnung_pdf_data(
    app: tauri::AppHandle,
    haendlernummer: String,
    abrechnungslauf_id: String,
) -> Result<HaendlerAbrechnungPdfData, String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;

    // Händlerstammdaten
    let mut h_stmt = conn
        .prepare(
            "SELECT haendlernummer, name, vorname, nachname, strasse, hausnummer, plz, stadt, email
             FROM haendler
             WHERE haendlernummer = ?1
             LIMIT 1",
        )
        .map_err(|e| e.to_string())?;
    let haendler = h_stmt
        .query_row(rusqlite::params![&haendlernummer], |row| {
            Ok(HaendlerAbrechnungPdfHaendler {
                haendlernummer: row.get(0)?,
                name: row.get(1)?,
                vorname: row.get(2)?,
                nachname: row.get(3)?,
                strasse: row.get(4)?,
                hausnummer: row.get(5)?,
                plz: row.get(6)?,
                stadt: row.get(7)?,
                email: row.get(8)?,
            })
        })
        .map_err(|_| "Händler nicht gefunden.".to_string())?;

    // Laufdaten
    let mut l_stmt = conn
        .prepare(
            "SELECT id, name, start_zeitpunkt, end_zeitpunkt
             FROM abrechnungslauf
             WHERE id = ?1
             LIMIT 1",
        )
        .map_err(|e| e.to_string())?;
    let lauf = l_stmt
        .query_row(rusqlite::params![&abrechnungslauf_id], |row| {
            Ok(HaendlerAbrechnungPdfLauf {
                id: row.get(0)?,
                name: row.get(1)?,
                start_zeitpunkt: row.get(2)?,
                end_zeitpunkt: row.get(3)?,
            })
        })
        .map_err(|_| "Abrechnungslauf nicht gefunden.".to_string())?;

    // Aggregate (stornos ausschließen) für Händler innerhalb des Laufes
    let mut a_stmt = conn
        .prepare(
            "SELECT COALESCE(SUM(b.betrag), 0) as summe, COUNT(b.id) as anzahl
             FROM buchungen b
             JOIN kundenabrechnung ka ON b.kundenabrechnung_id = ka.id
             WHERE b.haendlernummer = ?1
               AND ka.abrechnungslauf_id = ?2
               AND b.id NOT IN (SELECT buchung_id FROM stornos)",
        )
        .map_err(|e| e.to_string())?;
    let (summe, anzahl): (f64, i64) = a_stmt
        .query_row(rusqlite::params![&haendlernummer, &abrechnungslauf_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|e| e.to_string())?;

    Ok(HaendlerAbrechnungPdfData {
        haendler,
        lauf,
        werte: HaendlerAbrechnungPdfWerte { summe, anzahl },
    })
}

/// Alle Buchungen eines Händlers im aktuellen Abrechnungslauf,
/// inkl. Kassenbezug und Zeitstempel (Drilldown).
#[command]
pub fn get_buchungen_for_haendler(
    app: tauri::AppHandle,
    haendlernummer: String,
) -> Result<Vec<HaendlerBuchungItem>, String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    let lauf_id = get_aktiver_abrechnungslauf_id(&conn)?;
    let mut stmt = conn
        .prepare(
            "SELECT
                 b.id,
                 b.haendlernummer,
                 b.betrag,
                 b.bezeichnung,
                 ka.zeitstempel,
                 ka.kassen_id,
                 k.name as kassen_name,
                 (SELECT 1 FROM stornos s WHERE s.buchung_id = b.id LIMIT 1) IS NOT NULL as ist_storniert
             FROM buchungen b
             JOIN kundenabrechnung ka ON b.kundenabrechnung_id = ka.id
             LEFT JOIN kassen k ON ka.kassen_id = k.id
             WHERE b.haendlernummer = ?1
               AND ka.abrechnungslauf_id = ?2
             ORDER BY ka.kassen_id, ka.zeitstempel, b.id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![&haendlernummer, &lauf_id], |row| {
            Ok(HaendlerBuchungItem {
                id: row.get(0)?,
                haendlernummer: row.get(1)?,
                betrag: row.get(2)?,
                bezeichnung: row.get(3)?,
                zeitstempel: row.get(4)?,
                kassen_id: row.get(5)?,
                kassen_name: row.get(6)?,
                ist_storniert: row.get::<_, i32>(7)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

// ---------- Phase 3: Sync-Verbindungen ----------

fn normalize_ws_url(input: &str) -> String {
    let mut s = input.trim().to_string();
    while s.ends_with('/') {
        s.pop();
    }
    s.to_lowercase()
}

/// Startet den lokalen WebSocket-Server (falls my_ws_url gesetzt) und verbindet sich zu allen Peers für Sync.
#[command]
pub async fn start_sync_connections(app: tauri::AppHandle) -> Result<String, String> {
    let my_kassen_id = db::get_config(&app, "kassen_id")
        .map_err(|e| e.to_string())?
        .ok_or("Kassen-ID nicht gesetzt")?;
    let my_ws_url = db::get_config(&app, "my_ws_url")
        .map_err(|e| e.to_string())?
        .ok_or("Eigene Sync-URL nicht konfiguriert (Einstellungen)")?;

    let port = my_ws_url
        .rsplit(':')
        .next()
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or("Ungültige Sync-URL (Port fehlt, z.B. ws://IP:8766)")?;

    match server::start_ws_server(app.clone(), port).await {
        Ok(approve_tx) => {
            app.state::<MasterServerState>()
                .0
                .lock()
                .map_err(|e: std::sync::PoisonError<_>| e.to_string())?
                .replace(approve_tx);
        }
        Err(e) if e.contains("already in use") || e.contains("Address already in use") => {
            // Server läuft bereits (z. B. Master hat "Server starten" schon geklickt)
        }
        Err(e) => return Err(e),
    }

    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;

    // Eigene ws_url in der kassen-Tabelle auf aktuelle my_ws_url aktualisieren,
    // damit Peer-Listen (JoinApprove) und Sync-Targets nicht veralten.
    let _ = conn.execute(
        "UPDATE kassen SET ws_url = ?1 WHERE id = ?2",
        rusqlite::params![&my_ws_url, &my_kassen_id],
    );

    // Nebenkasse: wenn genau 1 Peer konfiguriert ist, aber die Hauptkassen-URL in config abweicht,
    // korrigieren wir den Peer-Eintrag auf master_ws_url (häufiger Fall: ws://127.0.0.1 ohne Port).
    let role = db::get_config(&app, "role")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    if role == "slave" {
        if let Some(master_ws_url) = db::get_config(&app, "master_ws_url").map_err(|e| e.to_string())? {
            let master_norm = normalize_ws_url(&master_ws_url);
            if master_norm != normalize_ws_url(&my_ws_url) {
                let mut peer_id_stmt = conn
                    .prepare(
                        "SELECT id FROM kassen WHERE ws_url IS NOT NULL AND ws_url != '' AND id != ?1",
                    )
                    .map_err(|e| e.to_string())?;
                let peer_ids: Vec<String> = peer_id_stmt
                    .query_map(rusqlite::params![&my_kassen_id], |row| row.get(0))
                    .map_err(|e| e.to_string())?
                    .filter_map(|r| r.ok())
                    .collect();
                if peer_ids.len() == 1 {
                    let _ = conn.execute(
                        "UPDATE kassen SET ws_url = ?1 WHERE id = ?2",
                        rusqlite::params![&master_ws_url, &peer_ids[0]],
                    );
                }
            }
        }
    }
    let mut stmt = conn
        .prepare(
            "SELECT id, ws_url FROM kassen WHERE ws_url IS NOT NULL AND ws_url != '' AND id != ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![&my_kassen_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let peers: Vec<(String, String)> = rows.filter_map(|r| r.ok()).collect();
    let my_ws_url_norm = normalize_ws_url(&my_ws_url);

    // Self-loop verhindern: Peer zeigt auf unsere eigene my_ws_url.
    let mut self_loop_peers: Vec<(String, String)> = Vec::new();
    let mut connect_peers: Vec<(String, String)> = Vec::new();
    for (peer_id, peer_ws_url) in peers {
        if normalize_ws_url(&peer_ws_url) == my_ws_url_norm {
            self_loop_peers.push((peer_id, peer_ws_url));
        } else {
            connect_peers.push((peer_id, peer_ws_url));
        }
    }

    // Auto-Bereinigung: Self-loop Peers aus Peer-Liste entfernen (ws_url NULL) + sync_state löschen.
    let mut removed_self_loops = 0usize;
    for (peer_id, _peer_ws_url) in &self_loop_peers {
        let updated = conn
            .execute(
                "UPDATE kassen SET ws_url = NULL WHERE id = ?1 AND ws_url IS NOT NULL AND ws_url != ''",
                rusqlite::params![peer_id],
            )
            .map_err(|e| e.to_string())?;
        if updated > 0 {
            let _ = conn.execute(
                "DELETE FROM sync_state WHERE peer_kassen_id = ?1",
                rusqlite::params![peer_id],
            );
            removed_self_loops += 1;
        }

        if let Some(sync_conns) = app.try_state::<server::SyncConnectionsState>() {
            let conns = sync_conns.0.clone();
            let peer_id = peer_id.clone();
            tokio::spawn(async move {
                let _ = conns.lock().await.remove(&peer_id);
            });
        }
    }

    if removed_self_loops > 0 {
        let _ = app.emit("sync-data-changed", ());
    }

    let peer_count = connect_peers.len();

    // Runtime-Status: Sync wurde gestartet (peers werden in Tasks verbunden).
    if let Ok(mut s) = app
        .state::<SyncRuntimeState>()
        .0
        .lock()
        .map_err(|e: std::sync::PoisonError<_>| e.to_string())
    {
        s.started = true;
        s.started_at = Some(chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.fZ").to_string());
        // connected_peers wird unten best-effort aktualisiert, aber initial 0 setzen.
        s.connected_peers = 0;
    }

    for (peer_id, peer_ws_url) in connect_peers {
        let app_clone = app.clone();
        let url = peer_ws_url.clone();
        tokio::spawn(async move {
            let mut backoff_secs = 5u64;
            const MAX_BACKOFF: u64 = 60;
            loop {
                match client::run_sync_to_peer(app_clone.clone(), &url, &peer_id).await {
                    Ok(()) => log::info!(
                        "Sync zu {} getrennt, Reconnect in {} s",
                        peer_id,
                        backoff_secs
                    ),
                    Err(e) => log::warn!(
                        "Sync zu {} fehlgeschlagen: {}, Reconnect in {} s",
                        peer_id,
                        e,
                        backoff_secs
                    ),
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(backoff_secs)).await;
                backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF);
            }
        });
    }

    Ok(format!(
        "Server gestartet, Sync zu {} Peer(s) gestartet. {} Selbstverbindung(en) entfernt.",
        peer_count
        ,removed_self_loops
    ))
}

#[command]
pub async fn get_sync_runtime_status(
    app: tauri::AppHandle,
    sync_conns: State<'_, SyncConnectionsState>,
) -> Result<SyncRuntimeStatus, String> {
    let connected_peers = sync_conns.connected_peer_ids().await.len();
    let mut status = app
        .state::<SyncRuntimeState>()
        .0
        .lock()
        .map_err(|e: std::sync::PoisonError<_>| e.to_string())?
        .clone();
    status.connected_peers = connected_peers;
    Ok(status)
}

// ---------- Discovery (Nebenkasse: Hauptkasse im Netzwerk suchen) ----------

#[derive(serde::Serialize)]
pub struct DiscoveredMasterItem {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub ws_url: String,
}

#[command]
pub async fn discover_masters() -> Result<Vec<DiscoveredMasterItem>, String> {
    let list = discovery::discover_masters(5).await?;
    Ok(list
        .into_iter()
        .map(|m| DiscoveredMasterItem {
            name: m.name,
            host: m.host,
            port: m.port,
            ws_url: m.ws_url,
        })
        .collect())
}

// ---------- Sync-Status (Phase 4) ----------

#[derive(serde::Serialize)]
pub struct SyncStatusEntry {
    pub peer_id: String,
    pub name: String,
    pub ws_url: String,
    pub connected: bool,
    pub last_sync: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closeout_ok_for_lauf_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closeout_ok_at: Option<String>,
}

#[command]
pub fn get_sync_status(
    app: tauri::AppHandle,
    sync_state: State<SyncStatusState>,
) -> Result<Vec<SyncStatusEntry>, String> {
    let my_kassen_id = db::get_config(&app, "kassen_id")
        .map_err(|e| e.to_string())?
        .ok_or("Kassen-ID nicht gesetzt")?;
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, ws_url FROM kassen WHERE ws_url IS NOT NULL AND ws_url != '' AND id != ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![&my_kassen_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let peers: Vec<(String, String, String)> = rows.filter_map(|r| r.ok()).collect();
    let peer_ids: Vec<String> = peers.iter().map(|(id, _, _)| id.clone()).collect();
    let statuses = sync_state.get_all_peers_status(&peer_ids);
    Ok(peers
        .into_iter()
        .zip(statuses.into_iter())
        .map(|((peer_id, name, ws_url), (_, status))| SyncStatusEntry {
            peer_id,
            name,
            ws_url,
            connected: status.connected,
            last_sync: status.last_sync,
            closeout_ok_for_lauf_id: status.closeout_ok_for_lauf_id,
            closeout_ok_at: status.closeout_ok_at,
        })
        .collect())
}

// ---------- Master: Kasse vom Netzwerk entkoppeln ----------

#[command]
pub async fn remove_peer_from_network(
    app: tauri::AppHandle,
    sync_conns: State<'_, SyncConnectionsState>,
    kassen_id: String,
) -> Result<(), String> {
    // #region agent log
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/Users/lutz/workspace/kassensystem/.cursor/debug-06ad72.log")
    {
        let _ = writeln!(
            file,
            "{{\"sessionId\":\"06ad72\",\"runId\":\"initial\",\"hypothesisId\":\"H3\",\"location\":\"commands.rs:remove_peer_from_network:entry\",\"message\":\"remove_peer_from_network called\",\"data\":{{\"kassen_id\":\"{}\"}},\"timestamp\":{}}}",
            kassen_id,
            chrono::Utc::now().timestamp_millis()
        );
    }
    // #endregion agent log

    let role = db::get_config(&app, "role")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    if role != "master" {
        return Err("Nur auf der Hauptkasse möglich.".to_string());
    }
    let my_kassen_id = db::get_config(&app, "kassen_id")
        .map_err(|e| e.to_string())?
        .ok_or("Kassen-ID nicht gesetzt")?;
    if kassen_id == my_kassen_id {
        return Err("Eigene Kasse kann nicht entfernt werden.".to_string());
    }

    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    // Nicht löschen: kassen.id wird von kundenabrechnung.kassen_id referenziert (FOREIGN KEY).
    // Stattdessen ws_url auf NULL setzen, dann erscheint die Kasse nicht mehr in der Peer-Liste.
    let updated = conn
        .execute(
            "UPDATE kassen SET ws_url = NULL WHERE id = ?1 AND ws_url IS NOT NULL AND ws_url != ''",
            rusqlite::params![&kassen_id],
        )
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err("Kasse nicht gefunden oder bereits entkoppelt.".to_string());
    }
    conn.execute("DELETE FROM sync_state WHERE peer_kassen_id = ?1", rusqlite::params![&kassen_id])
        .map_err(|e| e.to_string())?;

    sync_conns.remove_peer(&kassen_id).await;

    let _ = app.emit("sync-data-changed", ());
    Ok(())
}

// ---------- Reset Abrechnungslauf ----------

/// Löscht alle Kundenabrechnungen, Buchungen, Stornos und Sync-Stände; setzt Belegzähler zurück.
/// Händlerliste, Kassen und übrige Config bleiben erhalten.
#[command]
pub fn reset_abrechnungslauf(app: tauri::AppHandle) -> Result<String, String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;

    // Laufende Abrechnungsläufe beenden und neuen aktiven Lauf anlegen
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.fZ")
        .to_string();
    conn.execute(
        "UPDATE abrechnungslauf SET end_zeitpunkt = ?1, is_aktiv = 0 WHERE is_aktiv = 1",
        rusqlite::params![&now],
    )
    .map_err(|e| e.to_string())?;
    let new_lauf_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO abrechnungslauf (id, name, start_zeitpunkt, end_zeitpunkt, is_aktiv) VALUES (?1, ?2, ?3, NULL, 1)",
        rusqlite::params![&new_lauf_id, "Neuer Abrechnungslauf", &now],
    )
    .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM stornos", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM buchungen", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM kundenabrechnung", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sync_state", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM config WHERE key LIKE 'beleg_counter_%'", [])
        .map_err(|e| e.to_string())?;

    Ok("Abrechnungslauf zurückgesetzt. Händlerliste und Kassen unverändert.".to_string())
}

// ---------- Abrechnungsläufe verwalten ----------

#[command]
pub fn get_abrechnungsläufe(app: tauri::AppHandle) -> Result<Vec<AbrechnungslaufItem>, String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, start_zeitpunkt, end_zeitpunkt, is_aktiv
             FROM abrechnungslauf
             ORDER BY start_zeitpunkt DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(AbrechnungslaufItem {
                id: row.get(0)?,
                name: row.get(1)?,
                start_zeitpunkt: row.get(2)?,
                end_zeitpunkt: row.get(3)?,
                is_aktiv: row.get::<_, i32>(4)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[command]
pub async fn create_abrechnungslauf(
    app: tauri::AppHandle,
    name: String,
) -> Result<String, String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.fZ")
        .to_string();

    // Sicherheits-Gate: Auf der Hauptkasse erst neuen Lauf starten, wenn alle verbundenen Peers vollständig übernommen sind.
    let role = db::get_config(&app, "role")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    if role == "master" {
        if let (Some(sync_conns), Some(sync_status)) = (
            app.try_state::<SyncConnectionsState>(),
            app.try_state::<SyncStatusState>(),
        ) {
            let peer_ids = sync_conns.connected_peer_ids().await;
            for peer_id in peer_ids {
                if let Some(my_id) = db::get_config(&app, "kassen_id").map_err(|e| e.to_string())? {
                    if peer_id == my_id {
                        continue;
                    }
                }
                let status = sync_status.get(&peer_id);
                let peer_state = status
                    .state
                    .clone()
                    .ok_or_else(|| format!("Sync-Stand von {} unbekannt. Bitte Sync abwarten.", peer_id))?;

                let peer_reported_seq = peer_state.get(&peer_id).copied().unwrap_or(0);
                let our_max_seq: i64 = conn
                    .query_row(
                        "SELECT COALESCE(MAX(sequence), 0) FROM kundenabrechnung WHERE kassen_id = ?1",
                        rusqlite::params![&peer_id],
                        |row| row.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                if our_max_seq < peer_reported_seq {
                    return Err(format!(
                        "Sync noch nicht vollständig: Belege von {} fehlen auf der Hauptkasse (Master: {}, Peer: {}). Bitte Sync abwarten.",
                        peer_id, our_max_seq, peer_reported_seq
                    ));
                }

                let peer_reported_storno_ts = sync_status.get_peer_max_storno_zeitstempel(&peer_id);
                if let Some(required) = peer_reported_storno_ts {
                    let our_max_storno_ts: Option<String> = conn
                        .query_row(
                            "SELECT MAX(zeitstempel) FROM stornos WHERE kassen_id = ?1",
                            rusqlite::params![&peer_id],
                            |row| row.get(0),
                        )
                        .ok();
                    let ok = our_max_storno_ts
                        .as_deref()
                        .map(|m| m >= required.as_str())
                        .unwrap_or(false);
                    if !ok {
                        return Err(format!(
                            "Sync noch nicht vollständig: Stornos von {} fehlen auf der Hauptkasse. Bitte Sync abwarten.",
                            peer_id
                        ));
                    }
                }
            }
        }
    }

    conn.execute(
        "UPDATE abrechnungslauf SET end_zeitpunkt = ?1, is_aktiv = 0 WHERE is_aktiv = 1",
        rusqlite::params![&now],
    )
    .map_err(|e| e.to_string())?;

    let new_lauf_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO abrechnungslauf (id, name, start_zeitpunkt, end_zeitpunkt, is_aktiv) VALUES (?1, ?2, ?3, NULL, 1)",
        rusqlite::params![&new_lauf_id, &name, &now],
    )
    .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM stornos", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM buchungen", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM kundenabrechnung", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sync_state", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM config WHERE key LIKE 'beleg_counter_%'", [])
        .map_err(|e| e.to_string())?;

    // Verbundene Peers über neuen Lauf informieren (falls wir eine Sync-Server-Rolle haben)
    if let Some(state) = app.try_state::<SyncConnectionsState>() {
        let msg = Message::AbrechnungslaufReset(crate::sync::protocol::AbrechnungslaufReset {
            id: new_lauf_id.clone(),
            name: name.clone(),
            start_zeitpunkt: now.clone(),
        });
        state.broadcast(msg).await;
    }

    Ok(new_lauf_id)
}

#[command]
pub fn delete_abrechnungslauf(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT is_aktiv FROM abrechnungslauf WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(rusqlite::params![&id])
        .map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let is_aktiv: i32 = row.get(0).map_err(|e| e.to_string())?;
        if is_aktiv != 0 {
            return Err("Aktiver Abrechnungslauf kann nicht gelöscht werden.".to_string());
        }
    } else {
        return Err("Abrechnungslauf nicht gefunden.".to_string());
    }

    conn.execute(
        "DELETE FROM kundenabrechnung WHERE abrechnungslauf_id = ?1",
        rusqlite::params![&id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM abrechnungslauf WHERE id = ?1",
        rusqlite::params![&id],
    )
    .map_err(|e| e.to_string())?;

    Ok("Abrechnungslauf gelöscht.".to_string())
}

#[cfg(test)]
mod tests {
    use super::{get_aktiver_abrechnungslauf_id, normalize_ws_url};
    use rusqlite::Connection;

    fn create_tables(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS abrechnungslauf (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                start_zeitpunkt TEXT NOT NULL,
                end_zeitpunkt TEXT,
                is_aktiv INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT
            )",
        )
        .unwrap();
    }

    #[test]
    fn get_aktiver_abrechnungslauf_id_creates_default_when_empty() {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn);
        conn.execute("INSERT INTO config (key, value) VALUES ('role', 'master')", [])
            .unwrap();

        let id = get_aktiver_abrechnungslauf_id(&conn).unwrap();
        assert!(!id.is_empty());

        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM abrechnungslauf WHERE is_aktiv = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn get_aktiver_abrechnungslauf_id_returns_existing_active() {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn);
        let expected_id = "test-lauf-1";
        conn.execute(
            "INSERT INTO abrechnungslauf (id, name, start_zeitpunkt, end_zeitpunkt, is_aktiv) VALUES (?1, 'Test', '2025-01-01T00:00:00Z', NULL, 1)",
            rusqlite::params![expected_id],
        )
        .unwrap();

        let id = get_aktiver_abrechnungslauf_id(&conn).unwrap();
        assert_eq!(id, expected_id);
    }

    #[test]
    fn get_aktiver_abrechnungslauf_id_returns_active_among_multiple() {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn);
        conn.execute(
            "INSERT INTO abrechnungslauf (id, name, start_zeitpunkt, end_zeitpunkt, is_aktiv) VALUES ('inactive-1', 'Alt', '2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z', 0)",
            [],
        )
        .unwrap();
        let active_id = "active-lauf";
        conn.execute(
            "INSERT INTO abrechnungslauf (id, name, start_zeitpunkt, end_zeitpunkt, is_aktiv) VALUES (?1, 'Aktiv', '2025-01-01T00:00:00Z', NULL, 1)",
            rusqlite::params![active_id],
        )
        .unwrap();

        let id = get_aktiver_abrechnungslauf_id(&conn).unwrap();
        assert_eq!(id, active_id);
    }

    #[test]
    fn normalize_ws_url_trims_lowercases_and_removes_trailing_slash() {
        assert_eq!(
            normalize_ws_url("  WS://LOCALHOST:8766/  "),
            "ws://localhost:8766"
        );
        assert_eq!(normalize_ws_url("ws://127.0.0.1:8766////"), "ws://127.0.0.1:8766");
    }

    #[test]
    fn normalize_ws_url_makes_equivalent_urls_equal() {
        let a = normalize_ws_url("ws://192.168.1.10:8766");
        let b = normalize_ws_url(" WS://192.168.1.10:8766/ ");
        assert_eq!(a, b);
    }
}
