//! WebSocket-Server (Phase 2: Join, Phase 3: Sync)

use crate::db;
use crate::user_error::user_msg;
use crate::sync::protocol::{
    AbrechnungslaufReset, Ack, CloseoutApprove, CloseoutReject, CloseoutRequest, HaendlerListUpdate,
    JoinReject, LeaveNetworkAck, LeaveNetworkRequest, Message, RequestSlaveReset, SyncState,
};
use crate::sync::status::SyncStatusState;
use crate::sync::sync_db;
use futures_util::{SinkExt, StreamExt};
use log::{info, warn};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio::sync::Mutex;
use tokio::time::{interval, MissedTickBehavior};
use tokio_native_tls::TlsAcceptor;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message as WsMessage;

/// Sender für "sende diese Message an die Verbindung zu kassen_id"
pub type ApproveSender = mpsc::UnboundedSender<(String, Message)>;

/// Alle aktiven Sync-Verbindungen (peer_kassen_id → Sender für Push-Nachrichten z. B. HaendlerListUpdate).
pub struct SyncConnectionsState(
    pub Arc<tokio::sync::Mutex<HashMap<String, mpsc::UnboundedSender<Message>>>>,
);

impl Default for SyncConnectionsState {
    fn default() -> Self {
        Self(Arc::new(tokio::sync::Mutex::new(HashMap::new())))
    }
}

impl SyncConnectionsState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Entfernt die Verbindung zum Peer; durch Droppen des Senders bricht die Sync-Verbindung ab.
    pub async fn remove_peer(&self, kassen_id: &str) {
        let _ = self.0.lock().await.remove(kassen_id);
    }

    /// Liefert die IDs aller aktuell verbundenen Peers (für Peer-Checks).
    pub async fn connected_peer_ids(&self) -> Vec<String> {
        let guard = self.0.lock().await;
        guard.keys().cloned().collect()
    }

    /// Sendet eine Nachricht an alle verbundenen Peers.
    pub async fn broadcast(&self, msg: Message) {
        let mut guard = self.0.lock().await;
        for (_peer_id, tx) in guard.iter_mut() {
            let _ = tx.send(msg.clone());
        }
    }
}

/// Sender für "neue Verbindung mit join_request registrieren"
type RegisterSender = mpsc::UnboundedSender<(String, mpsc::UnboundedSender<Message>)>;

/// Startet den WebSocket-Server auf 0.0.0.0:port.
/// Gibt approve_tx zurück; wird in der App gespeichert, damit approve_join_request join_approve senden kann.
pub async fn start_ws_server(app: AppHandle, port: u16) -> Result<ApproveSender, String> {
    // Ensure TLS identity exists for this instance and build acceptor.
    let (identity, _fp) = crate::tls::ensure_identity_and_fingerprint(&app)?;
    let acceptor = native_tls::TlsAcceptor::new(identity).map_err(|e| e.to_string())?;
    let acceptor = TlsAcceptor::from(acceptor);

    let (approve_tx, approve_rx) = mpsc::unbounded_channel::<(String, Message)>();
    let (register_tx, register_rx) =
        mpsc::unbounded_channel::<(String, mpsc::UnboundedSender<Message>)>();

    let pending: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<Message>>>> =
        Arc::new(Mutex::new(HashMap::new()));

    let pending_approve = pending.clone();
    let pending_register = pending.clone();

    tokio::spawn(async move {
        let mut register_rx = register_rx;
        let mut approve_rx = approve_rx;
        loop {
            tokio::select! {
                Some((kassen_id, tx)) = register_rx.recv() => {
                    pending_register.lock().await.insert(kassen_id, tx);
                }
                Some((kassen_id, msg)) = approve_rx.recv() => {
                    if let Some(tx) = pending_approve.lock().await.remove(&kassen_id) {
                        let _ = tx.send(msg);
                    }
                }
                else => break,
            }
        }
    });

    let addr = format!("0.0.0.0:{}", port);
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e: std::io::Error| e.to_string())?;
    info!("WebSocket-Server lauscht auf {}", addr);

    let app_clone = app.clone();
    tokio::spawn(async move {
        let acceptor = acceptor;
        while let Ok((stream, _addr)) = listener.accept().await {
            let app_handle = app_clone.clone();
            let reg = register_tx.clone();
            let acceptor = acceptor.clone();
            tokio::spawn(async move {
                if let Err(e) = handle_connection(app_handle, stream, reg, acceptor).await {
                    warn!("Verbindung Fehler: {}", e);
                }
            });
        }
    });

    Ok(approve_tx)
}

async fn handle_connection(
    app: AppHandle,
    stream: tokio::net::TcpStream,
    register_tx: RegisterSender,
    acceptor: TlsAcceptor,
) -> Result<(), String> {
    // TLS handshake, then WebSocket upgrade.
    let tls_stream = acceptor.accept(stream).await.map_err(|e| e.to_string())?;
    let ws_stream = accept_async(tls_stream).await.map_err(|e| e.to_string())?;
    let (mut write, mut read) = ws_stream.split();

    // Erste Nachricht sollte join_request sein
    let first = read
        .next()
        .await
        .ok_or("Verbindung geschlossen")?
        .map_err(|e| e.to_string())?;

    let text = match first {
        WsMessage::Text(t) => t,
        WsMessage::Close(_) => return Ok(()),
        _ => {
            let _ = write
                .send(WsMessage::Text(
                    Message::Error(crate::sync::protocol::ErrorMsg {
                        code: "invalid_message".into(),
                        message: user_msg("errors.sync.expect_join_request"),
                    })
                    .to_json()
                    .unwrap_or_default(),
                ))
                .await;
            return Ok(());
        }
    };

    let msg = Message::from_json(&text).map_err(|e| e.to_string())?;

    // Slave → Master: Reset-Anfrage (einmalige Verbindung, Antwort auf gleichen Kanal)
    if let Message::RequestSlaveReset(ref req) = &msg {
        return handle_request_slave_reset(app, req, write).await;
    }

    // Slave → Master: Closeout-Anfrage (einmalige Verbindung, Antwort auf gleichen Kanal)
    if let Message::CloseoutRequest(ref req) = &msg {
        return handle_closeout_request(app, req, write).await;
    }

    // Slave → Master: Leave-Network (einmalige Verbindung, Antwort auf gleichen Kanal)
    if let Message::LeaveNetworkRequest(ref req) = &msg {
        return handle_leave_network_request(app, req, write).await;
    }

    // Phase 3: Sync-Verbindung (jede Kasse)
    if let Message::SyncState(their_state) = &msg {
        let sync_conns = app.state::<SyncConnectionsState>().0.clone();
        return handle_sync_connection(app, read, write, their_state, sync_conns).await;
    }

    // Phase 2: Join nur auf Hauptkasse
    let is_master = db::get_config(&app, "role")
        .map_err(|e| e.to_string())?
        .as_deref()
        == Some("master");
    if !is_master {
        let _ = write
            .send(WsMessage::Text(
                Message::Error(crate::sync::protocol::ErrorMsg {
                    code: "forbidden".into(),
                    message: user_msg("errors.sync.join_master_only"),
                })
                .to_json()
                .unwrap_or_default(),
            ))
            .await;
        return Ok(());
    }

    let (kassen_id, name, my_ws_url, token, cert_fingerprint) = match &msg {
        Message::JoinRequest(jr) => (
            jr.kassen_id.clone(),
            jr.name.clone(),
            jr.my_ws_url.clone(),
            jr.token.clone(),
            jr.cert_fingerprint.clone(),
        ),
        _ => {
            let _ = write
                .send(WsMessage::Text(
                    Message::Error(crate::sync::protocol::ErrorMsg {
                        code: "invalid_message".into(),
                        message: user_msg("errors.sync.first_message_invalid"),
                    })
                    .to_json()
                    .unwrap_or_default(),
                ))
                .await;
            return Ok(());
        }
    };

    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;

    let expected_token: Option<String> = conn
        .query_row(
            "SELECT value FROM config WHERE key = 'join_token'",
            [],
            |row| row.get(0),
        )
        .ok();

    let normalized: String = token.chars().filter(|c| c.is_ascii_digit()).collect();
    let valid = normalized.len() == 6 && expected_token.as_deref() == Some(normalized.as_str());

    if !valid {
        let _ = write
            .send(WsMessage::Text(
                Message::JoinReject(JoinReject {
                    reason: Some(user_msg("errors.sync.join_invalid_token")),
                })
                .to_json()
                .unwrap_or_default(),
            ))
            .await;
        return Ok(());
    }

    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO join_requests (id, kassen_id, name, status, my_ws_url, cert_fingerprint) VALUES (?1, ?2, ?3, 'pending', ?4, ?5)",
        rusqlite::params![id, kassen_id, name, my_ws_url, cert_fingerprint],
    )
    .map_err(|e| e.to_string())?;

    let _ = app.emit("join-request-pending", ());

    // Verbindung registrieren, damit wir später join_approve schicken können
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    register_tx
        .send((kassen_id.clone(), tx))
        .map_err(|e| e.to_string())?;

    // Bestätigung an Nebenkasse: "Anfrage erhalten, warte auf Freigabe"
    let _ = write
        .send(WsMessage::Text(
            Message::Error(crate::sync::protocol::ErrorMsg {
                code: "pending".into(),
                message: user_msg("errors.sync.join_pending_approval"),
            })
            .to_json()
            .unwrap_or_default(),
        ))
        .await;

    // Weiterleiten von join_approve an diesen Client (wird von approve_join_request getriggert)
    let mut write = write;
    while let Some(approve_msg) = rx.recv().await {
        if let Ok(json) = approve_msg.to_json() {
            let _ = write.send(WsMessage::Text(json)).await;
        }
        break;
    }

    Ok(())
}

async fn handle_leave_network_request(
    app: AppHandle,
    req: &LeaveNetworkRequest,
    mut write: impl futures_util::SinkExt<WsMessage> + Unpin,
) -> Result<(), String> {
    let is_master = db::get_config(&app, "role")
        .map_err(|e| e.to_string())?
        .as_deref()
        == Some("master");
    if !is_master {
        let _ = write
            .send(WsMessage::Text(
                Message::Error(crate::sync::protocol::ErrorMsg {
                    code: "forbidden".into(),
                    message: user_msg("errors.sync.leave_master_only"),
                })
                .to_json()
                .unwrap_or_default(),
            ))
            .await;
        return Ok(());
    }

    let my_kassen_id = db::get_config(&app, "kassen_id")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| user_msg("errors.config.register_id_missing"))?;
    if req.kassen_id == my_kassen_id {
        let _ = write
            .send(WsMessage::Text(
                Message::Error(crate::sync::protocol::ErrorMsg {
                    code: "invalid".into(),
                    message: user_msg("errors.peer.cannot_remove_self"),
                })
                .to_json()
                .unwrap_or_default(),
            ))
            .await;
        return Ok(());
    }

    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    let _ = conn.execute(
        "UPDATE kassen SET ws_url = NULL WHERE id = ?1 AND ws_url IS NOT NULL AND ws_url != ''",
        rusqlite::params![&req.kassen_id],
    );
    let _ = conn.execute(
        "DELETE FROM sync_state WHERE peer_kassen_id = ?1",
        rusqlite::params![&req.kassen_id],
    );

    if let Some(sync_conns) = app.try_state::<SyncConnectionsState>() {
        sync_conns.remove_peer(&req.kassen_id).await;
    }
    let _ = app.emit("sync-data-changed", ());

    let _ = write
        .send(WsMessage::Text(
            Message::LeaveNetworkAck(LeaveNetworkAck {
                kassen_id: req.kassen_id.clone(),
            })
            .to_json()
            .unwrap_or_default(),
        ))
        .await;
    Ok(())
}

/// Behandelt CloseoutRequest: Nur Master; prüft, ob Master alle Daten der Nebenkasse übernommen hat.
async fn handle_closeout_request(
    app: AppHandle,
    req: &CloseoutRequest,
    mut write: impl futures_util::SinkExt<WsMessage> + Unpin,
) -> Result<(), String> {
    let is_master = db::get_config(&app, "role")
        .map_err(|e| e.to_string())?
        .as_deref()
        == Some("master");
    if !is_master {
        let _ = write
            .send(WsMessage::Text(
                Message::CloseoutReject(CloseoutReject {
                    code: "forbidden".into(),
                    message: user_msg("errors.sync.closeout_master_only"),
                })
                .to_json()
                .unwrap_or_default(),
            ))
            .await;
        return Ok(());
    }

    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;

    let our_max_seq: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sequence), 0) FROM kundenabrechnung WHERE kassen_id = ?1",
            rusqlite::params![&req.kassen_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if our_max_seq < req.max_sequence {
        let _ = write
            .send(WsMessage::Text(
                Message::CloseoutReject(CloseoutReject {
                    code: "sync_pending".into(),
                    message: user_msg("errors.sync.closeout_receipts_pending"),
                })
                .to_json()
                .unwrap_or_default(),
            ))
            .await;
        return Ok(());
    }

    let our_max_storno_ts_opt: Option<String> = conn
        .query_row(
            "SELECT MAX(zeitstempel) FROM stornos WHERE kassen_id = ?1",
            rusqlite::params![&req.kassen_id],
            |row| row.get(0),
        )
        .ok();
    if let Some(ref required) = req.max_storno_zeitstempel {
        let ok = our_max_storno_ts_opt
            .as_deref()
            .map(|m| m >= required.as_str())
            .unwrap_or(false);
        if !ok {
            let _ = write
                .send(WsMessage::Text(
                    Message::CloseoutReject(CloseoutReject {
                        code: "storno_sync_pending".into(),
                        message: user_msg("errors.sync.closeout_voids_pending"),
                    })
                    .to_json()
                    .unwrap_or_default(),
                ))
                .await;
            return Ok(());
        }
    }

    let active_lauf_id_opt: Option<String> = conn
        .query_row(
            "SELECT id FROM abrechnungslauf WHERE is_aktiv = 1 LIMIT 1",
            [],
            |row| row.get(0),
        )
        .ok();

    if let Some(sync_status) = app.try_state::<SyncStatusState>() {
        let now = chrono::Utc::now()
            .format("%Y-%m-%dT%H:%M:%S%.fZ")
            .to_string();
        sync_status.set_closeout_ok(&req.kassen_id, active_lauf_id_opt.clone(), now);
    }

    let _ = write
        .send(WsMessage::Text(
            Message::CloseoutApprove(CloseoutApprove {
                kassen_id: req.kassen_id.clone(),
                master_has_sequence_upto: our_max_seq,
                master_has_storno_upto: our_max_storno_ts_opt,
                active_abrechnungslauf_id: active_lauf_id_opt,
            })
            .to_json()
            .unwrap_or_default(),
        ))
        .await;

    Ok(())
}

/// Behandelt RequestSlaveReset: Nur Master; prüft, ob alle Daten der Nebenkasse angekommen sind, dann AbrechnungslaufReset senden.
async fn handle_request_slave_reset(
    app: AppHandle,
    req: &RequestSlaveReset,
    mut write: impl futures_util::SinkExt<WsMessage> + Unpin,
) -> Result<(), String> {
    let is_master = db::get_config(&app, "role")
        .map_err(|e| e.to_string())?
        .as_deref()
        == Some("master");
    if !is_master {
        let _ = write
            .send(WsMessage::Text(
                Message::Error(crate::sync::protocol::ErrorMsg {
                    code: "forbidden".into(),
                    message: user_msg("errors.sync.reset_master_only"),
                })
                .to_json()
                .unwrap_or_default(),
            ))
            .await;
        return Ok(());
    }

    let path = db::db_path(&app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    let our_max: Option<i64> = conn
        .query_row(
            "SELECT MAX(sequence) FROM kundenabrechnung WHERE kassen_id = ?1",
            rusqlite::params![&req.kassen_id],
            |row| row.get(0),
        )
        .ok();
    let has_all = our_max.map(|m| m >= req.max_sequence).unwrap_or(req.max_sequence == 0);
    if !has_all {
        let _ = write
            .send(WsMessage::Text(
                Message::Error(crate::sync::protocol::ErrorMsg {
                    code: "sync_pending".into(),
                    message: user_msg("errors.sync.reset_slave_data_pending"),
                })
                .to_json()
                .unwrap_or_default(),
            ))
            .await;
        return Ok(());
    }

    // Prüfen, ob alle verbundenen Peers den vollständigen Sequenzstand dieser Nebenkasse haben
    if let (Some(sync_conns), Some(sync_status)) = (
        app.try_state::<SyncConnectionsState>(),
        app.try_state::<SyncStatusState>(),
    ) {
        let peer_ids = sync_conns.connected_peer_ids().await;
        for peer_id in &peer_ids {
            if peer_id == &req.kassen_id {
                continue;
            }
            let their_seq = sync_status.get_peer_sequence_for_kasse(peer_id, &req.kassen_id);
            if their_seq < req.max_sequence {
                let _ = write
                    .send(WsMessage::Text(
                        Message::Error(crate::sync::protocol::ErrorMsg {
                            code: "sync_peers_pending".into(),
                            message: user_msg("errors.sync.reset_peers_pending"),
                        })
                        .to_json()
                        .unwrap_or_default(),
                    ))
                    .await;
                return Ok(());
            }
        }
    }

    let (id, name, start): (String, String, String) = conn
        .query_row(
            "SELECT id, name, start_zeitpunkt FROM abrechnungslauf WHERE is_aktiv = 1 LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| user_msg("errors.billing_cycle.master_has_no_active"))?;

    let _ = write
        .send(WsMessage::Text(
            Message::AbrechnungslaufReset(AbrechnungslaufReset {
                id,
                name,
                start_zeitpunkt: start,
            })
            .to_json()
            .unwrap_or_default(),
        ))
        .await;

    Ok(())
}

/// Wird von approve_join_request aufgerufen: JoinApprove an die richtige Verbindung senden.
pub fn send_join_approve(approve_tx: &ApproveSender, kassen_id: &str, msg: Message) {
    let _ = approve_tx.send((kassen_id.to_string(), msg));
}

/// Phase 3: Sync nach eingehender sync_state-Nachricht.
/// Registriert die Verbindung in sync_conns, damit der Master HaendlerListUpdate pushen kann.
async fn handle_sync_connection(
    app: AppHandle,
    mut read: impl StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>> + Unpin,
    mut write: impl SinkExt<WsMessage> + Unpin,
    their_state: &SyncState,
    sync_conns: Arc<tokio::sync::Mutex<HashMap<String, mpsc::UnboundedSender<Message>>>>,
) -> Result<(), String> {
    let peer_id = their_state.my_kassen_id.clone();
    let (push_tx, mut push_rx) = mpsc::unbounded_channel::<Message>();
    sync_conns.lock().await.insert(peer_id.clone(), push_tx);

    if let Some(sync_status) = app.try_state::<SyncStatusState>() {
        sync_status.set_connected(&peer_id, true);
        sync_status.set_peer_state(&peer_id, their_state.state.clone());
        sync_status.set_peer_max_storno_zeitstempel(&peer_id, their_state.my_max_storno_zeitstempel.clone());
    }

    let my_kassen_id = db::get_config(&app, "kassen_id")
        .map_err(|e| e.to_string())?
        .ok_or("kassen_id nicht gesetzt")?;
    let our_state_map = sync_db::get_sync_state_map(&app)?;
    let my_max_storno_zeitstempel =
        sync_db::get_max_storno_zeitstempel_for_kasse(&app, &my_kassen_id)?;
    let our_state = SyncState {
        my_kassen_id: my_kassen_id.clone(),
        state: our_state_map,
        my_max_storno_zeitstempel,
    };
    let _ = write
        .send(WsMessage::Text(
            Message::SyncState(our_state.clone())
                .to_json()
                .unwrap_or_default(),
        ))
        .await;

    for (kassen_id, &our_max) in &our_state.state {
        let their_max = their_state.state.get(kassen_id).copied().unwrap_or(0);
        if our_max > their_max {
            let batch = sync_db::get_batch(&app, kassen_id, their_max)?;
            if !batch.items.is_empty() {
                let _ = write
                    .send(WsMessage::Text(
                        Message::KundenabrechnungBatch(batch)
                            .to_json()
                            .unwrap_or_default(),
                    ))
                    .await;
            }
        }
    }
    let storno_batch = sync_db::get_stornos_to_send(&app, &peer_id)?;
    if !storno_batch.stornos.is_empty() {
        let max_ts: Option<String> = storno_batch
            .stornos
            .iter()
            .map(|s| s.zeitstempel.clone())
            .max_by(|a, b| a.cmp(b));
        let _ = write
            .send(WsMessage::Text(
                Message::StornoBatch(storno_batch)
                    .to_json()
                    .unwrap_or_default(),
            ))
            .await;
        // last_sent_storno_zeitstempel wird erst nach Ack aktualisiert.
        if let Some(sync_status) = app.try_state::<SyncStatusState>() {
            sync_status.set_pending_storno_ack(&peer_id, max_ts);
        }
    }

    let mut sync_interval = interval(Duration::from_secs(10));
    sync_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            frame = read.next() => {
                let text = match frame {
                    Some(Ok(WsMessage::Text(t))) => t,
                    Some(Ok(WsMessage::Close(_))) | None => break,
                    _ => continue,
                };
                let msg = match Message::from_json(&text) {
                    Ok(m) => m,
                    _ => continue,
                };
                match msg {
                    Message::SyncState(ref s) => {
                        if let Some(sync_status) = app.try_state::<SyncStatusState>() {
                            sync_status.set_peer_state(&peer_id, s.state.clone());
                            sync_status.set_peer_max_storno_zeitstempel(
                                &peer_id,
                                s.my_max_storno_zeitstempel.clone(),
                            );
                        }
                        for (kassen_id, &our_max) in &sync_db::get_sync_state_map(&app)? {
                            let their_max = s.state.get(kassen_id).copied().unwrap_or(0);
                            if our_max > their_max {
                                let batch = sync_db::get_batch(&app, kassen_id, their_max)?;
                                if !batch.items.is_empty() {
                                    let _ = write
                                        .send(WsMessage::Text(Message::KundenabrechnungBatch(batch).to_json().unwrap_or_default()))
                                        .await;
                                }
                            }
                        }
                        let storno_batch = sync_db::get_stornos_to_send(&app, &peer_id)?;
                        if !storno_batch.stornos.is_empty() {
                            let max_ts: Option<String> = storno_batch
                                .stornos
                                .iter()
                                .map(|s| s.zeitstempel.clone())
                                .max_by(|a, b| a.cmp(b));
                            let _ = write
                                .send(WsMessage::Text(Message::StornoBatch(storno_batch).to_json().unwrap_or_default()))
                                .await;
                            if let Some(sync_status) = app.try_state::<SyncStatusState>() {
                                sync_status.set_pending_storno_ack(&peer_id, max_ts);
                            }
                        }
                    }
                    Message::KundenabrechnungBatch(batch) => {
                        let pid = their_state.my_kassen_id.clone();
                        let max_seq = sync_db::apply_batch(&app, &pid, &batch)?;
                        let _ = app.emit("sync-data-changed", ());
                        let _ = write
                            .send(WsMessage::Text(
                                Message::Ack(Ack {
                                    peer_kassen_id: pid,
                                    last_sequence: max_seq,
                                    last_storno_zeitstempel: None,
                                })
                                .to_json()
                                .unwrap_or_default(),
                            ))
                            .await;
                    }
                    Message::StornoBatch(batch) => {
                        let _ = sync_db::apply_stornos(&app, &batch);
                        let _ = app.emit("sync-data-changed", ());
                        let max_ts: Option<String> = batch
                            .stornos
                            .iter()
                            .map(|s| s.zeitstempel.clone())
                            .max_by(|a, b| a.cmp(b));
                        let _ = write
                            .send(WsMessage::Text(
                                Message::Ack(Ack {
                                    peer_kassen_id: peer_id.clone(),
                                    last_sequence: 0,
                                    last_storno_zeitstempel: max_ts,
                                })
                                .to_json()
                                .unwrap_or_default(),
                            ))
                            .await;
                    }
                    Message::Ack(ack) => {
                        if let Some(ref ts) = ack.last_storno_zeitstempel {
                            if let Some(sync_status) = app.try_state::<SyncStatusState>() {
                                if sync_status.consume_pending_storno_ack(&peer_id, ts) {
                                    let _ = sync_db::update_last_sent_storno(&app, &peer_id, ts);
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            push_msg = push_rx.recv() => {
                let msg = match push_msg {
                    Some(m) => m,
                    None => break,
                };
                if let Ok(json) = msg.to_json() {
                    let _ = write.send(WsMessage::Text(json)).await;
                }
            }
            _ = sync_interval.tick() => {
                if let Ok(our_state_map) = sync_db::get_sync_state_map(&app) {
                    let my_max_storno_zeitstempel =
                        sync_db::get_max_storno_zeitstempel_for_kasse(&app, &my_kassen_id).ok().flatten();
                    let our_state = SyncState {
                        my_kassen_id: my_kassen_id.clone(),
                        state: our_state_map,
                        my_max_storno_zeitstempel,
                    };
                    let _ = write
                        .send(WsMessage::Text(Message::SyncState(our_state).to_json().unwrap_or_default()))
                        .await;
                }
            }
        }
    }

    if let Some(sync_status) = app.try_state::<SyncStatusState>() {
        sync_status.set_connected(&peer_id, false);
        sync_status.set_peer_state(&peer_id, std::collections::HashMap::new());
    }
    sync_conns.lock().await.remove(&peer_id);
    Ok(())
}

/// Sendet die aktuelle Händlerliste an alle verbundenen Sync-Clients (Nebenkassen). Nur auf der Hauptkasse aufrufen.
pub async fn broadcast_haendler_list(
    app: &AppHandle,
    haendler: Vec<crate::sync::protocol::HaendlerInfo>,
) -> Result<(), String> {
    let state = app
        .try_state::<SyncConnectionsState>()
        .ok_or_else(|| user_msg("errors.internal.sync_connections_unavailable"))?;
    let msg = Message::HaendlerListUpdate(HaendlerListUpdate {
        haendler: haendler.clone(),
    });
    let mut guard = state.0.lock().await;
    for (_peer_id, tx) in guard.iter_mut() {
        let _ = tx.send(msg.clone());
    }
    Ok(())
}
