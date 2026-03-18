//! Laufender Sync-Verbindungsstatus pro Peer (für UI).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct PeerSyncStatus {
    pub connected: bool,
    pub last_sync: Option<String>,
    /// Letzter von diesem Peer gemeldeter Sync-Stand: kassen_id -> last_sequence (aus SyncState.state).
    pub state: Option<HashMap<String, i64>>,
    /// Wenn wir Stornos an diesen Peer gesendet haben, warten wir auf ein Ack bis zu diesem Zeitstempel.
    pub pending_storno_ack_upto: Option<String>,
    /// Letzter vom Peer gemeldeter MAX-Storno-Zeitstempel (nur für die eigene kassen_id des Peers).
    pub peer_max_storno_zeitstempel: Option<String>,
    /// Closeout/Abmelden: wurde auf der Hauptkasse für diese Peer-Kasse bestätigt?
    pub closeout_ok_for_lauf_id: Option<String>,
    pub closeout_ok_at: Option<String>,
}

pub struct SyncStatusState(Arc<Mutex<HashMap<String, PeerSyncStatus>>>);

impl Default for SyncStatusState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(HashMap::new())))
    }
}

impl SyncStatusState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_connected(&self, peer_kassen_id: &str, connected: bool) {
        if let Ok(mut m) = self.0.lock() {
            let e = m.entry(peer_kassen_id.to_string()).or_default();
            e.connected = connected;
        }
    }

    pub fn set_last_sync(&self, peer_kassen_id: &str, iso_timestamp: String) {
        if let Ok(mut m) = self.0.lock() {
            let e = m.entry(peer_kassen_id.to_string()).or_default();
            e.last_sync = Some(iso_timestamp);
        }
    }

    pub fn get(&self, peer_kassen_id: &str) -> PeerSyncStatus {
        self.0
            .lock()
            .ok()
            .and_then(|m| m.get(peer_kassen_id).cloned())
            .unwrap_or_default()
    }

    pub fn get_all_peers_status(&self, peer_ids: &[String]) -> Vec<(String, PeerSyncStatus)> {
        let m = match self.0.lock() {
            Ok(guard) => guard,
            Err(_) => {
                return peer_ids
                    .iter()
                    .cloned()
                    .map(|id| (id, PeerSyncStatus::default()))
                    .collect()
            }
        };
        peer_ids
            .iter()
            .map(|id| (id.clone(), m.get(id).cloned().unwrap_or_default()))
            .collect()
    }

    /// Speichert den von diesem Peer gemeldeten Sync-Stand (aus SyncState.state).
    pub fn set_peer_state(&self, peer_kassen_id: &str, state: HashMap<String, i64>) {
        if let Ok(mut m) = self.0.lock() {
            let e = m.entry(peer_kassen_id.to_string()).or_default();
            e.state = Some(state);
        }
    }

    pub fn set_peer_max_storno_zeitstempel(&self, peer_kassen_id: &str, ts: Option<String>) {
        if let Ok(mut m) = self.0.lock() {
            let e = m.entry(peer_kassen_id.to_string()).or_default();
            e.peer_max_storno_zeitstempel = ts;
        }
    }

    pub fn get_peer_max_storno_zeitstempel(&self, peer_kassen_id: &str) -> Option<String> {
        self.0
            .lock()
            .ok()
            .and_then(|m| m.get(peer_kassen_id).and_then(|p| p.peer_max_storno_zeitstempel.clone()))
    }

    /// Gibt die letzte bekannte sequence für kassen_id zurück, die dieser Peer gemeldet hat (0 wenn unbekannt).
    pub fn get_peer_sequence_for_kasse(&self, peer_kassen_id: &str, kassen_id: &str) -> i64 {
        self.0
            .lock()
            .ok()
            .and_then(|m| {
                m.get(peer_kassen_id)
                    .and_then(|p| p.state.as_ref())
                    .and_then(|state| state.get(kassen_id).copied())
            })
            .unwrap_or(0)
    }

    /// Merkt sich, bis zu welchem Zeitstempel wir Stornos an diesen Peer gesendet haben.
    pub fn set_pending_storno_ack(&self, peer_kassen_id: &str, upto: Option<String>) {
        if let Ok(mut m) = self.0.lock() {
            let e = m.entry(peer_kassen_id.to_string()).or_default();
            e.pending_storno_ack_upto = upto;
        }
    }

    /// Konsumiert ein Storno-Ack, wenn es unsere pending-Marke abdeckt (>= pending).
    /// Gibt true zurück, wenn der Ack akzeptiert wurde und wir den Watermark fortschreiben dürfen.
    pub fn consume_pending_storno_ack(&self, peer_kassen_id: &str, ack_ts: &str) -> bool {
        let mut m = match self.0.lock() {
            Ok(g) => g,
            Err(_) => return false,
        };
        let e = m.entry(peer_kassen_id.to_string()).or_default();
        let pending = match e.pending_storno_ack_upto.as_deref() {
            Some(p) => p,
            None => return false,
        };
        if ack_ts >= pending {
            e.pending_storno_ack_upto = None;
            true
        } else {
            false
        }
    }

    pub fn set_closeout_ok(&self, peer_kassen_id: &str, lauf_id: Option<String>, iso_at: String) {
        if let Ok(mut m) = self.0.lock() {
            let e = m.entry(peer_kassen_id.to_string()).or_default();
            e.closeout_ok_for_lauf_id = lauf_id;
            e.closeout_ok_at = Some(iso_at);
        }
    }
}
