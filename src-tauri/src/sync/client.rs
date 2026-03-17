//! WebSocket-Client: Join-Request (Phase 2) und Peer-Sync (Phase 3)

use crate::db;
use crate::sync::protocol::{
    Ack, AbrechnungslaufReset, JoinApprove, JoinRequest, Message, RequestSlaveReset, SyncState,
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
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message as WsMessage;

/// Verbindet sich zu master_url, sendet join_request und wartet auf join_approve oder join_reject.
/// Gibt bei Erfolg die JoinApprove-Daten zurück.
pub async fn send_join_request(
    master_url: &str,
    kassen_id: &str,
    name: &str,
    my_ws_url: &str,
    token: &str,
) -> Result<JoinApprove, String> {
    let (ws_stream, _) = connect_async(master_url).await.map_err(|e| e.to_string())?;
    let (mut write, mut read) = ws_stream.split();

    let msg = Message::JoinRequest(JoinRequest {
        kassen_id: kassen_id.to_string(),
        name: name.to_string(),
        my_ws_url: my_ws_url.to_string(),
        token: token.to_string(),
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
    let (ws_stream, _) = connect_async(master_url).await.map_err(|e| e.to_string())?;
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

/// Phase 3: Verbindet sich zu einem Peer, sendet sync_state und tauscht Batches aus. Läuft bis Verbindung abbricht.
pub async fn run_sync_to_peer(
    app: AppHandle,
    peer_ws_url: &str,
    peer_kassen_id: &str,
) -> Result<(), String> {
    let (ws_stream, _) = connect_async(peer_ws_url)
        .await
        .map_err(|e| e.to_string())?;
    let (mut write, mut read) = ws_stream.split();

    if let Some(state) = app.try_state::<SyncStatusState>() {
        state.set_connected(peer_kassen_id, true);
    }

    let my_kassen_id = db::get_config(&app, "kassen_id")
        .map_err(|e| e.to_string())?
        .ok_or("kassen_id nicht gesetzt")?;
    let state_map = sync_db::get_sync_state_map(&app)?;
    let our_state = SyncState {
        my_kassen_id: my_kassen_id.clone(),
        state: state_map.clone(),
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
                            let max_ts: Option<String> = storno_batch.stornos.iter().map(|s| s.zeitstempel.clone()).max_by(|a, b| a.cmp(b));
                            let _ = write
                                .send(WsMessage::Text(
                                    Message::StornoBatch(storno_batch).to_json().unwrap_or_default(),
                                ))
                                .await;
                            if let Some(ref ts) = max_ts {
                                let _ = sync_db::update_last_sent_storno(&app, peer_kassen_id, ts);
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
                    }
                    Message::AbrechnungslaufReset(reset) => {
                        let _ = sync_db::apply_abrechnungslauf_reset(&app, &reset);
                        let _ = app.emit("sync-data-changed", ());
                    }
                    _ => {}
                }
            }
            _ = sync_interval.tick() => {
                if let Ok(state_map) = sync_db::get_sync_state_map(&app) {
                    let our_state = SyncState {
                        my_kassen_id: my_kassen_id.clone(),
                        state: state_map,
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
