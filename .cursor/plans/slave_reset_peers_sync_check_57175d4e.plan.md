---
name: slave_reset_peers_sync_check
overview: Erweitere den Slave-Reset-Flow so, dass die Hauptkasse beim Reset prüft, ob andere Peers den vollständigen Sequenzstand des Slaves kennen.
todos: []
isProject: false
---

### Ziel

Beim Aufruf von `request_slave_reset` soll die Hauptkasse nicht nur prüfen, ob **sie selbst** alle Sequenzen der Nebenkasse hat, sondern optional auch, ob **alle aktuell verbundenen Peers** mindestens diesen Sequenzstand kennen. Nur wenn alle Peers "auf Stand" sind, wird `AbrechnungslaufReset` zurückgegeben.

### Relevante Stellen

- Backend:
  - `[src-tauri/src/sync/protocol.rs](src-tauri/src/sync/protocol.rs)`: `RequestSlaveReset`, `AbrechnungslaufReset`, `Message` Enum.
  - `[src-tauri/src/sync/server.rs](src-tauri/src/sync/server.rs)`: `handle_connection`, `handle_sync_connection`, `handle_request_slave_reset` (bereits vorhanden), `SyncConnectionsState` (aktuelle Verbindungen).
  - `[src-tauri/src/sync/status.rs](src-tauri/src/sync/status.rs)`: `SyncStatusState`, `PeerSyncStatus` mit `last_sequence` usw.
  - `[src-tauri/src/sync/sync_db.rs](src-tauri/src/sync/sync_db.rs)`: `get_sync_state_map`, `apply_batch`.
- Frontend/Commands (bleiben unverändert):
  - `[src-tauri/src/commands.rs](src-tauri/src/commands.rs)`: `request_slave_reset` ruft bereits `send_slave_reset_request` auf.
  - `[src-tauri/src/sync/client.rs](src-tauri/src/sync/client.rs)`: `send_slave_reset_request` (Slave → Master) ist schon im Einsatz.

### Grobe Architektur des Checks (High-Level)

- Die Hauptkasse ermittelt wie bisher `our_max` (lokaler MAX(sequence) für `req.kassen_id`).
- Zusätzlich fragt sie den aktuellen **Sync-Status** aller Peers ab (z. B. über `SyncStatusState`), insbesondere deren bekannte `last_sequence` für diese `kassen_id`.
- Wenn irgendein Peer einen kleineren Stand als `req.max_sequence` hat, wird der Reset mit einer klaren Fehlermeldung abgelehnt (z. B. "Nicht alle Peers kennen alle Buchungen dieser Nebenkasse").
- Nur wenn **sowohl** Hauptkasse als auch alle Peers `>= max_sequence` sind (oder keine Peers vorhanden sind), wird `AbrechnungslaufReset` gesendet.

### Konkrete Umsetzungsschritte

1. **Sync-Status-Struktur prüfen und ggf. minimal erweitern**
  - In `[src-tauri/src/sync/status.rs](src-tauri/src/sync/status.rs)` nachsehen, wie `PeerSyncStatus` aussieht (enthält bereits `last_sequence` und `last_sync` pro Peer).
  - Verifizieren, dass `SyncStatusState` eine Map `peer_kassen_id -> PeerSyncStatus` mit Zugriffsfunktionen bietet.
  - Falls noch nicht vorhanden, optional eine Helper-Methode ergänzen (z. B. `get_all()`), um alle `PeerSyncStatus` auf einmal zu erhalten. (Nur planen, Implementierung erfolgt nach Plan-Freigabe.)
2. `**handle_request_slave_reset` um Peer-Check erweitern**
  - In `[src-tauri/src/sync/server.rs](src-tauri/src/sync/server.rs)` innerhalb von `handle_request_slave_reset` nach der bisherigen Prüfung `has_all` für die Hauptkasse einen zusätzlichen Block einfügen:
    - Per `app.try_state::<SyncStatusState>()` den Sync-Status holen.
    - Für **alle** bekannten Peers die jeweils letzte bekannte `last_sequence` für `req.kassen_id` bestimmen:
      - Entweder direkt aus einem Feld wie `peer.last_sequence` (wenn es global ist),
      - oder – falls `PeerSyncStatus` nur einen Timestamp enthält – diesen Schritt überspringen und stattdessen diesen optionalen Schritt auf später verschieben (Plan sieht primär den Check über `sync_state` der Hauptkasse vor).
    - Vergleich: Wenn ein Peer `last_sequence < req.max_sequence` hat (oder `last_sequence` unbekannt/nicht gesetzt ist), gilt `peers_ok = false`.
  - Wenn `!peers_ok`: `Message::Error` mit Code z. B. `"sync_peers_pending"` und klarer deutscher Fehlermeldung zurückgeben:
    - Beispiel: "Nicht alle verbundenen Kassen haben alle Buchungen dieser Nebenkasse übernommen. Bitte Sync abwarten und erneut versuchen.".
3. **Fallback-Variante mit `sync_state`-Tabelle (falls `SyncStatusState` keine Sequenzen enthält)**
  - Falls `SyncStatusState` kein Sequenzwissen pro Peer hat, stattdessen eine alternative, einfachere Variante nutzen:
    - Die Master-Datenbank enthält in der Tabelle `sync_state` den letzten **von jedem Peer gemeldeten** Stand.
    - Hier könnte eine zusätzliche Helper-Funktion in `[src-tauri/src/sync/sync_db.rs](src-tauri/src/sync/sync_db.rs)` geplant werden, z. B. `get_peer_state_map(app: &AppHandle) -> Result<HashMap<String, i64>, String>`, die `peer_kassen_id -> last_sequence` zurückgibt.
    - In `handle_request_slave_reset` wird dann über diese Map iteriert, um zu prüfen, ob alle `last_sequence`-Werte für `req.kassen_id` >= `req.max_sequence` sind (oder 0, wenn es keine Einträge gibt).
  - Der Plan priorisiert die **einfache Konsistenzprüfung über die Masterdaten**; die Peer-Map wird nur genutzt, falls wirklich auf der Masterseite gespeichert.
4. **Fehlercodes und UX für den Slave konsistent halten**
  - In `[src-tauri/src/sync/server.rs](src-tauri/src/sync/server.rs)` den neuen Fehlercode (`sync_peers_pending`) konsistent mit bestehenden Fehlern (`forbidden`, `sync_pending`) halten.
  - Der Slave sieht diesen Fehler bereits über `send_slave_reset_request` → `Message::Error` als `Err(e.message)`.
  - Der existierende UI-Flow in `[src/components/EinstellungenView.tsx](src/components/EinstellungenView.tsx)` zeigt `slaveResetMessage` bereits textlich an; hier ist **keine** zusätzliche Änderung notwendig, außer ggf. Anpassung der Formulierung bei Bedarf.
5. **Tests / Manuelle Prüfstrategie**
  - Szenario 1: Nur Hauptkasse + betroffene Nebenkasse verbunden, andere Peers offline → Reset sollte funktionieren, sobald die Hauptkasse alle Sequenzen hat.
  - Szenario 2: Weitere Peer-Kasse online, deren `last_sequence` für die Nebenkasse **hinterherhinkt** → Reset-Anfrage vom Slave muss mit `sync_peers_pending` abgelehnt werden.
  - Szenario 3: Nach einmaligem Sync aller Peers (alle haben Stand >= `req.max_sequence`) → erneute Reset-Anfrage wird akzeptiert und führt zu `AbrechnungslaufReset`.

### Todos

- **peers-check-impl**: `handle_request_slave_reset` um Peer-Check (über `SyncStatusState` oder `sync_state`-Tabelle) erweitern und neuen Fehlercode `sync_peers_pending` einführen.
- **peer-state-helper** (optional): In `sync_status.rs` oder `sync_db.rs` eine Hilfsfunktion bereitstellen, die alle relevanten Peer-Stände für eine `kassen_id` zurückgibt.
- **manual-tests-reset-peers**: Manuelle Tests für die drei oben beschriebenen Szenarien durchführen (Master + 1 Slave, Master + 2 Slaves, unterschiedliche Sync-Stände).

