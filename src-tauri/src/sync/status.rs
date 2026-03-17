//! Laufender Sync-Verbindungsstatus pro Peer (für UI).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct PeerSyncStatus {
    pub connected: bool,
    pub last_sync: Option<String>,
    /// Letzter von diesem Peer gemeldeter Sync-Stand: kassen_id -> last_sequence (aus SyncState.state).
    pub state: Option<HashMap<String, i64>>,
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
}
