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

#[derive(serde::Serialize)]
pub struct AbrechnungslaufItem {
    pub id: String,
    pub name: String,
    pub start_zeitpunkt: String,
    pub end_zeitpunkt: Option<String>,
    pub is_aktiv: bool,
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
        // Fallback: Default-Lauf anlegen, falls keiner existiert
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
}

const HAENDLER_SELECT: &str = "SELECT haendlernummer, name, sort, vorname, nachname, strasse, hausnummer, plz, stadt FROM haendler ORDER BY sort, haendlernummer";

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
) -> Result<(), String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO haendler (haendlernummer, name, sort, vorname, nachname, strasse, hausnummer, plz, stadt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
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
) -> Result<(), String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE haendler SET name = ?1, sort = ?2, vorname = ?3, nachname = ?4, strasse = ?5, hausnummer = ?6, plz = ?7, stadt = ?8 WHERE haendlernummer = ?9",
        rusqlite::params![
            &name,
            sort,
            &vorname,
            &nachname,
            &strasse,
            &hausnummer,
            &plz,
            &stadt,
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
            "INSERT INTO haendler (haendlernummer, name, sort, vorname, nachname, strasse, hausnummer, plz, stadt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
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
    let peer_count = peers.len();

    for (peer_id, peer_ws_url) in peers {
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
        "Server gestartet, Sync zu {} Peer(s) gestartet.",
        peer_count
    ))
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
    pub connected: bool,
    pub last_sync: Option<String>,
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
            "SELECT id, name FROM kassen WHERE ws_url IS NOT NULL AND ws_url != '' AND id != ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![&my_kassen_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let peers: Vec<(String, String)> = rows.filter_map(|r| r.ok()).collect();
    let peer_ids: Vec<String> = peers.iter().map(|(id, _)| id.clone()).collect();
    let statuses = sync_state.get_all_peers_status(&peer_ids);
    Ok(peers
        .into_iter()
        .zip(statuses.into_iter())
        .map(|((peer_id, name), (_, status))| SyncStatusEntry {
            peer_id,
            name,
            connected: status.connected,
            last_sync: status.last_sync,
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
pub fn create_abrechnungslauf(
    app: tauri::AppHandle,
    name: String,
) -> Result<String, String> {
    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
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
        let connections = state.0.clone(); // Arc<Mutex<HashMap<..>>>, unabhängig vom App-Lebenszyklus
        let msg = Message::AbrechnungslaufReset(crate::sync::protocol::AbrechnungslaufReset {
            id: new_lauf_id.clone(),
            name: name.clone(),
            start_zeitpunkt: now.clone(),
        });
        tauri::async_runtime::spawn(async move {
            let mut guard = connections.lock().await;
            for (_peer_id, tx) in guard.iter_mut() {
                let _ = tx.send(msg.clone());
            }
        });
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
    use super::get_aktiver_abrechnungslauf_id;
    use rusqlite::Connection;

    fn create_abrechnungslauf_table(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS abrechnungslauf (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                start_zeitpunkt TEXT NOT NULL,
                end_zeitpunkt TEXT,
                is_aktiv INTEGER NOT NULL DEFAULT 0
            )",
        )
        .unwrap();
    }

    #[test]
    fn get_aktiver_abrechnungslauf_id_creates_default_when_empty() {
        let conn = Connection::open_in_memory().unwrap();
        create_abrechnungslauf_table(&conn);

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
        create_abrechnungslauf_table(&conn);
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
        create_abrechnungslauf_table(&conn);
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
}
