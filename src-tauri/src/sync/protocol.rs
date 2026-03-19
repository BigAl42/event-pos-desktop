//! WebSocket-Nachrichtenformate für Join und Sync (Phase 2+)

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Eine WebSocket-Nachricht hat immer ein Feld `type`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Message {
    /// Slave → Master: Anfrage dem Netz beizutreten
    JoinRequest(JoinRequest),
    /// Master → Slave: Anfrage angenommen, Peer-Liste + Händlerliste
    JoinApprove(JoinApprove),
    /// Master → Slave: Anfrage abgelehnt
    JoinReject(JoinReject),
    /// Master → Slave(n): Aktualisierte Händlerliste
    HaendlerListUpdate(HaendlerListUpdate),
    /// Sync: Mein Stand (kassen_id → letzte sequence)
    SyncState(SyncState),
    /// Sync: Batch Kundenabrechnungen inkl. Buchungen
    KundenabrechnungBatch(KundenabrechnungBatch),
    /// Sync: Bestätigung erhalten
    Ack(Ack),
    /// Phase 4: Storno-Sync – Liste von Stornos zum Anwenden
    StornoBatch(StornoBatch),
    /// Master → Slaves: neuer Abrechnungslauf gestartet, lokale Daten zurücksetzen
    AbrechnungslaufReset(AbrechnungslaufReset),
    /// Slave → Master: Anfrage, lokalen Abrechnungslauf zu leeren (Master prüft Sync-Stand und sendet ggf. AbrechnungslaufReset)
    RequestSlaveReset(RequestSlaveReset),
    /// Slave → Master: Closeout/Abmelden-Anfrage (Master bestätigt, dass alle Daten angekommen sind)
    CloseoutRequest(CloseoutRequest),
    /// Master → Slave: Closeout bestätigt
    CloseoutApprove(CloseoutApprove),
    /// Master → Slave: Closeout abgelehnt
    CloseoutReject(CloseoutReject),
    /// Slave → Master: Nebenkasse verlässt das Netzwerk (Master entfernt Peer aus Liste).
    LeaveNetworkRequest(LeaveNetworkRequest),
    /// Master → Slave: Bestätigung, dass Peer entfernt wurde.
    LeaveNetworkAck(LeaveNetworkAck),
    /// Allgemeiner Fehler
    Error(ErrorMsg),
}

/// Slave → Master: Bitte um Reset; Master prüft, ob alle Daten der Nebenkasse angekommen sind.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestSlaveReset {
    pub kassen_id: String,
    pub max_sequence: i64,
}

/// Slave → Master: Closeout/Abmelden: Slave meldet seinen aktuellen Stand (Buchungen + Stornos),
/// Master bestätigt, dass er mindestens bis zu diesen Marken übernommen hat.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloseoutRequest {
    pub kassen_id: String,
    pub max_sequence: i64,
    /// MAX(zeitstempel) der Stornos dieser Kasse (oder None, falls keine Stornos existieren).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_storno_zeitstempel: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloseoutApprove {
    pub kassen_id: String,
    pub master_has_sequence_upto: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub master_has_storno_upto: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_abrechnungslauf_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloseoutReject {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaveNetworkRequest {
    pub kassen_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaveNetworkAck {
    pub kassen_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinRequest {
    pub kassen_id: String,
    pub name: String,
    pub my_ws_url: String,
    pub token: String,
    pub cert_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinApprove {
    pub master_kassen_id: String,
    pub peers: Vec<PeerInfo>,
    pub haendler: Vec<HaendlerInfo>,
    pub master_cert_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_abrechnungslauf_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_abrechnungslauf_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_abrechnungslauf_start: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInfo {
    pub kassen_id: String,
    pub name: String,
    pub ws_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cert_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaendlerInfo {
    pub haendlernummer: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vorname: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nachname: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strasse: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hausnummer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plz: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stadt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinReject {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaendlerListUpdate {
    pub haendler: Vec<HaendlerInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorMsg {
    pub code: String,
    pub message: String,
}

// ---------- Phase 3: Sync ----------

/// state: kassen_id → letzte bekannte sequence
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncState {
    pub my_kassen_id: String,
    pub state: HashMap<String, i64>,
    /// Optional: MAX(zeitstempel) aller Stornos dieser Kasse (wird für Laufwechsel-Gates genutzt).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub my_max_storno_zeitstempel: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KundenabrechnungBatch {
    pub items: Vec<KundenabrechnungItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub abrechnungslauf_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KundenabrechnungItem {
    pub kundenabrechnung: KundenabrechnungRow,
    pub buchungen: Vec<BuchungRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KundenabrechnungRow {
    pub id: String,
    pub kassen_id: String,
    pub person1_name: Option<String>,
    pub person2_name: Option<String>,
    pub zeitstempel: String,
    pub belegnummer: Option<String>,
    pub sequence: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuchungRow {
    pub id: String,
    pub kundenabrechnung_id: String,
    pub haendlernummer: String,
    pub betrag: f64,
    pub bezeichnung: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ack {
    pub peer_kassen_id: String,
    pub last_sequence: i64,
    /// Optional: Bestätigt, bis zu welchem Storno-Zeitstempel der Empfänger Stornos angewendet hat.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_storno_zeitstempel: Option<String>,
}

/// Phase 4: Storno-Sync
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StornoBatch {
    pub stornos: Vec<StornoRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StornoRow {
    pub id: String,
    pub buchung_id: String,
    pub kassen_id: String,
    pub zeitstempel: String,
    pub kundenabrechnung_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AbrechnungslaufReset {
    pub id: String,
    pub name: String,
    pub start_zeitpunkt: String,
}

impl Message {
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    pub fn from_json(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }
}
