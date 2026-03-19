//! WebSocket-Client: Join-Request (Phase 2) und Peer-Sync (Phase 3)

use crate::db;
use crate::sync::protocol::{
    Ack, AbrechnungslaufReset, CloseoutApprove, CloseoutReject, CloseoutRequest, JoinApprove,
    JoinRequest, LeaveNetworkAck, LeaveNetworkRequest, Message, RequestSlaveReset, SyncState,
};
use crate::sync::status::SyncStatusState;
use crate::sync::sync_db;
use futures_util::{SinkExt, StreamExt};
use log::info;
use std::time::Duration;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tokio::time::{interval, MissedTickBehavior};
use tokio::net::TcpStream;
use tokio_native_tls::TlsConnector;
use tokio_tungstenite::client_async;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use url::Url;

async fn connect_wss_raw(
    url: &str,
) -> Result<
    (
        tokio_tungstenite::WebSocketStream<tokio_native_tls::TlsStream<TcpStream>>,
        String,
    ),
    String,
> {
    let parsed = Url::parse(url).map_err(|e| e.to_string())?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "Ungültige URL (host fehlt)".to_string())?;
    let port = parsed.port_or_known_default().ok_or_else(|| "Ungültige URL (port fehlt)".to_string())?;
    let addr = format!("{}:{}", host, port);

    let tcp = TcpStream::connect(&addr).await.map_err(|e| e.to_string())?;

    let connector = native_tls::TlsConnector::builder()
        // Pinning (TOFU) is enforced at the app layer; we do not rely on public PKI in LAN.
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .build()
        .map_err(|e| e.to_string())?;
    let connector = TlsConnector::from(connector);

    let tls = connector.connect(host, tcp).await.map_err(|e| e.to_string())?;
    let peer_fp = tls
        .get_ref()
        .peer_certificate()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Kein Peer-Zertifikat erhalten".to_string())
        .and_then(|c| c.to_der().map_err(|e| e.to_string()))
        .map(|der| crate::tls::sha256_fingerprint_hex(&der))?;
    let req = url.into_client_request().map_err(|e| e.to_string())?;
    let (ws, _resp) = client_async(req, tls).await.map_err(|e| e.to_string())?;
    Ok((ws, peer_fp))
}

async fn connect_wss(url: &str) -> Result<tokio_tungstenite::WebSocketStream<tokio_native_tls::TlsStream<TcpStream>>, String> {
    Ok(connect_wss_raw(url).await?.0)
}

async fn connect_wss_pinned(
    app: &AppHandle,
    url: &str,
    peer_kassen_id: &str,
) -> Result<tokio_tungstenite::WebSocketStream<tokio_native_tls::TlsStream<TcpStream>>, String> {
    let (ws, peer_fp) = connect_wss_raw(url).await?;
    if let Some(expected) = db::get_cert_pin(app, peer_kassen_id).map_err(|e| e.to_string())? {
        if !expected.trim().is_empty() && expected.trim() != peer_fp {
            return Err(format!(
                "TLS Zertifikat-Fingerprint passt nicht zu Pin für {} (expected {}, got {}).",
                peer_kassen_id,
                expected.trim(),
                peer_fp
            ));
        }
    }
    Ok(ws)
}

/// Verbindet sich zu master_url, sendet join_request und wartet auf join_approve oder join_reject.
/// Gibt bei Erfolg die JoinApprove-Daten zurück.
pub async fn send_join_request(
    master_url: &str,
    kassen_id: &str,
    name: &str,
    my_ws_url: &str,
    token: &str,
    cert_fingerprint: &str,
) -> Result<JoinApprove, String> {
    let ws_stream = connect_wss(master_url).await?;
    let (mut write, mut read) = ws_stream.split();

    let msg = Message::JoinRequest(JoinRequest {
        kassen_id: kassen_id.to_string(),
        name: name.to_string(),
        my_ws_url: my_ws_url.to_string(),
        token: token.to_string(),
        cert_fingerprint: cert_fingerprint.to_string(),
    });
    let json = msg.to_json().map_err(|e| e.to_string())?;
    write
        .send(WsMessage::Text(json))
        .await
        .map_err(|e| e.to_string())?;

    while let Some(Ok(frame)) = read.next().await {
        match frame {
            WsMessage::Text(text) => {
                let msg = Message::from_json(&text).map_err(|e| e.to_string())?;
                match msg {
                    Message::JoinApprove(approve) => return Ok(approve),
                    Message::JoinReject(reject) => {
                        return Err(reject.reason.unwrap_or_else(|| "Abgelehnt".into()))
                    }
                    Message::Error(e) => {
                        if e.code == "pending" {
                            info!(
                                "Join-Anfrage gespeichert, warte auf Freigabe: {}",
                                e.message
                            );
                            continue;
                        }
                        return Err(e.message);
                    }
                    _ => {}
                }
            }
            WsMessage::Close(_) => break,
            _ => {}
        }
    }

    Err("Verbindung geschlossen ohne join_approve".into())
}

/// Sendet eine Reset-Anfrage an die Hauptkasse; bei Erfolg wird AbrechnungslaufReset zurückgegeben (Anwendung erfolgt im Aufrufer).
pub async fn send_slave_reset_request(
    master_url: &str,
    kassen_id: &str,
    max_sequence: i64,
) -> Result<AbrechnungslaufReset, String> {
    let ws_stream = connect_wss(master_url).await?;
    let (mut write, mut read) = ws_stream.split();

    let msg = Message::RequestSlaveReset(RequestSlaveReset {
        kassen_id: kassen_id.to_string(),
        max_sequence,
    });
    let json = msg.to_json().map_err(|e| e.to_string())?;
    write
        .send(WsMessage::Text(json))
        .await
        .map_err(|e| e.to_string())?;

    let frame = read
        .next()
        .await
        .ok_or("Verbindung geschlossen")?
        .map_err(|e| e.to_string())?;
    let text = match frame {
        WsMessage::Text(t) => t,
        _ => return Err("Unerwartete Nachricht".into()),
    };
    let resp = Message::from_json(&text).map_err(|e| e.to_string())?;
    match resp {
        Message::AbrechnungslaufReset(r) => Ok(r),
        Message::Error(e) => Err(e.message),
        _ => Err("Unerwartete Antwort".into()),
    }
}

/// Sendet eine Closeout-Anfrage an die Hauptkasse; bei Erfolg wird CloseoutApprove zurückgegeben.
pub async fn send_closeout_request(
    master_url: &str,
    kassen_id: &str,
    max_sequence: i64,
    max_storno_zeitstempel: Option<String>,
) -> Result<CloseoutApprove, String> {
    let ws_stream = connect_wss(master_url).await?;
    let (mut write, mut read) = ws_stream.split();

    let msg = Message::CloseoutRequest(CloseoutRequest {
        kassen_id: kassen_id.to_string(),
        max_sequence,
        max_storno_zeitstempel,
    });
    let json = msg.to_json().map_err(|e| e.to_string())?;
    write
        .send(WsMessage::Text(json))
        .await
        .map_err(|e| e.to_string())?;

    let frame = read
        .next()
        .await
        .ok_or("Verbindung geschlossen")?
        .map_err(|e| e.to_string())?;
    let text = match frame {
        WsMessage::Text(t) => t,
        _ => return Err("Unerwartete Nachricht".into()),
    };
    let resp = Message::from_json(&text).map_err(|e| e.to_string())?;
    match resp {
        Message::CloseoutApprove(r) => Ok(r),
        Message::CloseoutReject(CloseoutReject { message, .. }) => Err(message),
        Message::Error(e) => Err(e.message),
        _ => Err("Unerwartete Antwort".into()),
    }
}

/// Sendet eine Leave-Network-Anfrage an die Hauptkasse; bei Erfolg wird LeaveNetworkAck zurückgegeben.
pub async fn send_leave_network_request(
    master_url: &str,
    kassen_id: &str,
) -> Result<LeaveNetworkAck, String> {
    let ws_stream = connect_wss(master_url).await?;
    let (mut write, mut read) = ws_stream.split();

    let msg = Message::LeaveNetworkRequest(LeaveNetworkRequest {
        kassen_id: kassen_id.to_string(),
    });
    let json = msg.to_json().map_err(|e| e.to_string())?;
    write
        .send(WsMessage::Text(json))
        .await
        .map_err(|e| e.to_string())?;

    let frame = read
        .next()
        .await
        .ok_or("Verbindung geschlossen")?
        .map_err(|e| e.to_string())?;
    let text = match frame {
        WsMessage::Text(t) => t,
        _ => return Err("Unerwartete Nachricht".into()),
    };
    let resp = Message::from_json(&text).map_err(|e| e.to_string())?;
    match resp {
        Message::LeaveNetworkAck(r) => Ok(r),
        Message::Error(e) => Err(e.message),
        _ => Err("Unerwartete Antwort".into()),
    }
}

/// Phase 3: Verbindet sich zu einem Peer, sendet sync_state und tauscht Batches aus. Läuft bis Verbindung abbricht.
pub async fn run_sync_to_peer(
    app: AppHandle,
    peer_ws_url: &str,
    peer_kassen_id: &str,
) -> Result<(), String> {
    let ws_stream = connect_wss_pinned(&app, peer_ws_url, peer_kassen_id).await?;
    let (mut write, mut read) = ws_stream.split();

    if let Some(state) = app.try_state::<SyncStatusState>() {
        state.set_connected(peer_kassen_id, true);
    }

    let my_kassen_id = db::get_config(&app, "kassen_id")
        .map_err(|e| e.to_string())?
        .ok_or("kassen_id nicht gesetzt")?;
    let state_map = sync_db::get_sync_state_map(&app)?;
    let my_max_storno_zeitstempel =
        sync_db::get_max_storno_zeitstempel_for_kasse(&app, &my_kassen_id)?;
    let our_state = SyncState {
        my_kassen_id: my_kassen_id.clone(),
        state: state_map.clone(),
        my_max_storno_zeitstempel,
    };
    let _ = write
        .send(WsMessage::Text(
            Message::SyncState(our_state).to_json().unwrap_or_default(),
        ))
        .await;

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
                    Message::SyncState(their_state) => {
                        if let Some(sync_state) = app.try_state::<SyncStatusState>() {
                            sync_state.set_peer_max_storno_zeitstempel(
                                peer_kassen_id,
                                their_state.my_max_storno_zeitstempel.clone(),
                            );
                        }
                        let our_state_map = sync_db::get_sync_state_map(&app)?;
                        for (kassen_id, &our_max) in &our_state_map {
                            let their_max = their_state.state.get(kassen_id).copied().unwrap_or(0);
                            if our_max > their_max {
                                let batch = sync_db::get_batch(&app, kassen_id, their_max)?;
                                if !batch.items.is_empty() {
                                    let _ = write
                                        .send(WsMessage::Text(
                                            Message::KundenabrechnungBatch(batch).to_json().unwrap_or_default(),
                                        ))
                                        .await;
                                }
                            }
                        }
                        let storno_batch = sync_db::get_stornos_to_send(&app, peer_kassen_id)?;
                        if !storno_batch.stornos.is_empty() {
                            let max_ts: Option<String> = storno_batch
                                .stornos
                                .iter()
                                .map(|s| s.zeitstempel.clone())
                                .max_by(|a, b| a.cmp(b));
                            let _ = write
                                .send(WsMessage::Text(
                                    Message::StornoBatch(storno_batch).to_json().unwrap_or_default(),
                                ))
                                .await;
                            // last_sent_storno_zeitstempel wird erst nach Ack aktualisiert (siehe Ack handling).
                            if let Some(sync_state) = app.try_state::<SyncStatusState>() {
                                sync_state.set_pending_storno_ack(peer_kassen_id, max_ts);
                            }
                        }
                        if let Some(sync_state) = app.try_state::<SyncStatusState>() {
                            let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.fZ").to_string();
                            sync_state.set_last_sync(peer_kassen_id, now);
                        }
                    }
                    Message::KundenabrechnungBatch(batch) => {
                        let max_seq = sync_db::apply_batch(&app, peer_kassen_id, &batch)?;
                        let _ = app.emit("sync-data-changed", ());
                        let _ = write
                            .send(WsMessage::Text(
                                Message::Ack(Ack {
                                    peer_kassen_id: peer_kassen_id.to_string(),
                                    last_sequence: max_seq,
                                    last_storno_zeitstempel: None,
                                })
                                .to_json()
                                .unwrap_or_default(),
                            ))
                            .await;
                        if let Some(sync_state) = app.try_state::<SyncStatusState>() {
                            let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.fZ").to_string();
                            sync_state.set_last_sync(peer_kassen_id, now);
                        }
                    }
                    Message::HaendlerListUpdate(update) => {
                        let _ = sync_db::apply_haendler_list(&app, &update.haendler);
                    }
                    Message::StornoBatch(batch) => {
                        let _ = sync_db::apply_stornos(&app, &batch);
                        let _ = app.emit("sync-data-changed", ());
                        // Storno-Ack: bestätige den max Zeitstempel, den wir gerade angewendet haben.
                        let max_ts: Option<String> = batch
                            .stornos
                            .iter()
                            .map(|s| s.zeitstempel.clone())
                            .max_by(|a, b| a.cmp(b));
                        let _ = write
                            .send(WsMessage::Text(
                                Message::Ack(Ack {
                                    peer_kassen_id: peer_kassen_id.to_string(),
                                    last_sequence: 0,
                                    last_storno_zeitstempel: max_ts,
                                })
                                .to_json()
                                .unwrap_or_default(),
                            ))
                            .await;
                    }
                    Message::AbrechnungslaufReset(reset) => {
                        let _ = sync_db::apply_abrechnungslauf_reset(&app, &reset);
                        let _ = app.emit("sync-data-changed", ());
                    }
                    Message::Ack(ack) => {
                        // Kundenabrechnung-Acks werden derzeit nicht für Wasserstände genutzt (sync_state wird beim Apply gesetzt).
                        // Storno-Ack ist relevant: erst hier last_sent_storno_zeitstempel fortschreiben.
                        if let Some(ref ts) = ack.last_storno_zeitstempel {
                            if let Some(sync_state) = app.try_state::<SyncStatusState>() {
                                if sync_state.consume_pending_storno_ack(peer_kassen_id, ts) {
                                    let _ = sync_db::update_last_sent_storno(&app, peer_kassen_id, ts);
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            _ = sync_interval.tick() => {
                if let Ok(state_map) = sync_db::get_sync_state_map(&app) {
                    let my_max_storno_zeitstempel =
                        sync_db::get_max_storno_zeitstempel_for_kasse(&app, &my_kassen_id).ok().flatten();
                    let our_state = SyncState {
                        my_kassen_id: my_kassen_id.clone(),
                        state: state_map,
                        my_max_storno_zeitstempel,
                    };
                    let _ = write
                        .send(WsMessage::Text(Message::SyncState(our_state).to_json().unwrap_or_default()))
                        .await;
                }
            }
        }
    }

    if let Some(sync_state) = app.try_state::<SyncStatusState>() {
        sync_state.set_connected(peer_kassen_id, false);
    }

    Ok(())
}
