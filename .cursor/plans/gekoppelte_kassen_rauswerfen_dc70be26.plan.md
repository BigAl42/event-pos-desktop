---
name: Gekoppelte Kassen rauswerfen
overview: "Der Master kann bereits gekoppelte Kassen (Slaves) aus dem Netzwerk entfernen: Backend-Command entfernt die Kasse aus der DB und schließt die Sync-Verbindung; die UI bietet in der Startseiten-Kassenliste und in der Sync-Status-Ansicht einen „Rauswerfen“-Button (nur Master)."
todos: []
isProject: false
---

# Gekoppelte Kassen rauswerfen

## Ziel

Der Master soll bereits angemeldete/gekoppelte Kassen (Slaves) aus dem Netzwerk werfen können. Die Kasse verschwindet aus der Peer-Liste, die Sync-Verbindung wird geschlossen, und der Slave kann nur durch erneutes Beitreten (Join) wieder dazukommen.

## Aktueller Stand

- **Peers** kommen aus der Tabelle `kassen` (`[commands.rs](src-tauri/src/commands.rs)` Zeilen 701–711): `SELECT id, name FROM kassen WHERE ws_url IS NOT NULL AND id != ?` (eigene Kassen-ID).
- **Sync-Verbindungen** liegen im Master in `[SyncConnectionsState](src-tauri/src/sync/server.rs)` (HashMap `peer_id` → Sender). Beim Entfernen einer Kasse muss diese Verbindung geschlossen werden (Sender aus Map entfernen und droppen).
- **Sync-Stand** pro Peer liegt in `sync_state` (`[sync_db.rs](src-tauri/src/sync/sync_db.rs)`); beim Entfernen des Peers sollte die Zeile gelöscht werden.
- **UI:** „Angemeldete Kassen“ auf der [Startseite](src/components/Startseite.tsx) (Zeilen 196–218) und [SyncStatusView](src/components/SyncStatusView.tsx) listen alle Peers, bisher ohne Aktion „Rauswerfen“.

## Implementierung

### 1. Backend: Peer aus Verbindungsmap entfernen

**Datei:** `[src-tauri/src/sync/server.rs](src-tauri/src/sync/server.rs)`

- In `SyncConnectionsState` eine async-Methode ergänzen, z. B. `pub async fn remove_peer(&self, kassen_id: &str)`: Eintrag zu `kassen_id` aus der inneren `HashMap` entfernen. Durch das Droppen des `UnboundedSender` bricht die Sync-Verbindung zum Slave hin ab.

### 2. Backend: Tauri-Command „Kasse aus Netzwerk entfernen“

**Datei:** `[src-tauri/src/commands.rs](src-tauri/src/commands.rs)`

- Neues Command nur für **Master**, z. B. `remove_peer_from_network`:
  - Parameter: `kassen_id: String`.
  - Prüfung: Rolle muss `"master"` sein; `kassen_id` darf nicht die eigene Kassen-ID sein.
  - `DELETE FROM kassen WHERE id = ?` (nur diese eine Kasse).
  - `DELETE FROM sync_state WHERE peer_kassen_id = ?` (Sync-Stand dieses Peers löschen).
  - `SyncConnectionsState` aus dem App-State holen und `remove_peer(&kassen_id).await` aufrufen, damit die WebSocket-Verbindung geschlossen wird.
- Command in `[src-tauri/src/lib.rs](src-tauri/src/lib.rs)` im `invoke_handler` registrieren.

Optional: Nach dem Entfernen ein Event emittieren (z. B. `sync-data-changed`), damit die UI sofort aktualisieren kann; das Polling (getSyncStatus alle paar Sekunden) würde die Liste ohnehin anpassen.

### 3. Frontend: API-Anbindung

**Datei:** `[src/db.ts](src/db.ts)`

- Neue Funktion, z. B. `removePeerFromNetwork(kassenId: string): Promise<void>`, die `invoke("remove_peer_from_network", { kassenId })` aufruft.

### 4. Frontend: „Rauswerfen“-Button in der UI (nur Master)

**Sync-Status-Ansicht** (`[src/components/SyncStatusView.tsx](src/components/SyncStatusView.tsx)`):

- Rolle ermitteln (`getConfig("role")`) bzw. State dafür anlegen; nur wenn `role === "master"` pro Eintrag einen Button „Rauswerfen“ anzeigen.
- Klick: `removePeerFromNetwork(e.peer_id)` aufrufen, bei Erfolg Liste neu laden (`load()`), bei Fehler Meldung anzeigen (z. B. State für `error`).

**Startseite – Angemeldete Kassen** (`[src/components/Startseite.tsx](src/components/Startseite.tsx)`):

- In der Liste „Angemeldete Kassen“ (bereits `role === "master"`) pro Kasse einen Button „Rauswerfen“ hinzufügen.
- Klick: `removePeerFromNetwork(e.peer_id)`; die bestehende Aktualisierung per Intervall aktualisiert die Liste automatisch, optional nach Erfolg sofort `getSyncStatus()` erneut aufrufen.

**Styling:** In `[SyncStatusView.css](src/components/SyncStatusView.css)` bzw. `[Startseite.css](src/components/Startseite.css)` eine Klasse für den „Rauswerfen“-Button (z. B. sekundär/warn-Optik), konsistent mit bestehenden Buttons.

### 5. Verhalten auf der Slave-Seite

- Der Slave erhält kein explizites „Du bist raus“-Protokoll; die WebSocket-Verbindung bricht ab (Master schließt den Kanal).
- Der bestehende Sync-Client setzt beim Verbindungsabbruch bereits `set_connected(peer_kassen_id, false)` (`[client.rs](src-tauri/src/sync/client.rs)` Zeile 190). Der Slave versucht ggf. Reconnect; da er nicht mehr in der Master-`kassen`-Liste ist, wird er beim nächsten Join (mit neuem Token) wieder aufgenommen. Ob der Slave nach „Rauswerfen“ die Master-URL/Peers behält oder zurücksetzt, bleibt unverändert (kein Verhalten geändert).

## Betroffene Dateien


| Bereich  | Datei                                                  | Änderung                                               |
| -------- | ------------------------------------------------------ | ------------------------------------------------------ |
| Backend  | `src-tauri/src/sync/server.rs`                         | `SyncConnectionsState::remove_peer(kassen_id)`         |
| Backend  | `src-tauri/src/commands.rs`                            | Command `remove_peer_from_network`                     |
| Backend  | `src-tauri/src/lib.rs`                                 | Command registrieren                                   |
| Frontend | `src/db.ts`                                            | `removePeerFromNetwork(kassenId)`                      |
| Frontend | `src/components/SyncStatusView.tsx`                    | Rolle laden, „Rauswerfen“-Button pro Peer (nur Master) |
| Frontend | `src/components/Startseite.tsx`                        | „Rauswerfen“-Button pro Kasse in „Angemeldete Kassen“  |
| Frontend | `src/components/SyncStatusView.css` / `Startseite.css` | Styles für Rauswerfen-Button                           |


## Kurzfassung

- **Backend:** Kasse aus `kassen` und `sync_state` löschen, Verbindung in `SyncConnectionsState` entfernen (Sender droppen).
- **Frontend:** Nur im Master in Sync-Status und auf der Startseite bei „Angemeldete Kassen“ einen „Rauswerfen“-Button pro Peer; Aufruf von `removePeerFromNetwork(peer_id)` und danach Liste aktualisieren.

