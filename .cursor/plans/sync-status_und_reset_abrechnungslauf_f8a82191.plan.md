---
name: Sync-Status und Reset Abrechnungslauf
overview: "Zwei Themen: (1) Sync-Anzeige korrigieren, sodass beide Seiten (Master und Slave) den Verbindungsstatus korrekt anzeigen, indem der Server beim Akzeptieren einer Sync-Verbindung den Status setzt. (2) Einen Reset für einen neuen Abrechnungslauf implementieren: alle Buchungen/Kundenabrechnungen/Stornos und Sync-Stände löschen, Belegzähler zurücksetzen, Händlerliste und Kassen/Config unverändert lassen."
todos: []
isProject: false
---

# Sync-Status korrigieren + Reset Abrechnungslauf

## 1. Sync-Anzeige: Slave zeigt immer „nicht verbunden“

### Ursache

Der Verbindungsstatus (`connected`) wird nur in der **Client**-Logik gesetzt ([src-tauri/src/sync/client.rs](src-tauri/src/sync/client.rs): `set_connected(peer_kassen_id, true)` nach `connect_async`, `false` beim Schließen). Die **Server**-Seite ([src-tauri/src/sync/server.rs](src-tauri/src/sync/server.rs), `handle_sync_connection`) aktualisiert `SyncStatusState` nicht.

Ablauf typisch:

- **Master** startet Sync und verbindet sich als **Client** zum **Slave** → im Master-Prozess wird `set_connected(slave_id, true)` gesetzt → Master zeigt „verbunden“.
- **Slave** startet Sync und verbindet sich als **Client** zum **Master** → nur wenn diese Verbindung gelingt, setzt der Slave `set_connected(master_id, true)`. Wenn die Verbindung vom Slave zum Master fehlschlägt (Netzwerk, Firewall, Master nicht erreichbar), bleibt der Slave-Status „nicht verbunden“, obwohl der Master bereits verbunden ist (weil der Master als Client zum Slave verbunden hat).

Zusätzlich: Selbst wenn beide Verbindungen stehen, wird der Status nur von der Seite gesetzt, die **als Client** verbunden ist. Die Seite, die **als Server** die Verbindung annimmt, schreibt nie in `SyncStatusState`. Dadurch kann die Anzeige einseitig oder verzögert sein.

### Lösung

Die **Server**-Seite soll den gleichen Status führen wie der Client:

- In [src-tauri/src/sync/server.rs](src-tauri/src/sync/server.rs) in `**handle_sync_connection`**:
  - Direkt nach dem Eintragen in `sync_conns` (Peer-ID bekannt): `SyncStatusState` aus `app` holen und `set_connected(peer_id, true)` aufrufen.
  - Beim Verlassen der Funktion (Verbindung zu Ende, vor `sync_conns.lock().await.remove(&peer_id)`): `set_connected(peer_id, false)` aufrufen.

Dann gilt:

- Wenn der **Slave** vom **Master** eine eingehende Sync-Verbindung akzeptiert, setzt der Slave sofort `connected = true` für den Master.
- Wenn der **Master** vom **Slave** eine eingehende Sync-Verbindung akzeptiert, setzt der Master `connected = true` für den Slave.

Damit stimmt die Anzeige auf beiden Seiten, unabhängig davon, wer die Verbindung initiiert hat.

---

## 2. Reset für neuen Abrechnungslauf

### Anforderung

- „Neuen kompletten Abrechnungslauf starten“: Alle Buchungsdaten bereinigen, System für einen neuen Lauf vorbereiten.
- „Alle Buchungen archivieren“: Hier als „Daten löschen“ umgesetzt (keine separaten Archiv-Tabellen). Optional später: Export/Backup vor dem Löschen.
- „Händlerliste soll erhalten bleiben“: Tabelle `haendler` und alle übrigen Stammdaten/Config unangetastet.

### Datenbank-Änderungen

- **Löschen:**
  - `stornos` (Referenzen auf Buchungen)
  - `buchungen`
  - `kundenabrechnung`
  - `sync_state` (Sync-Stände pro Peer, damit beim nächsten Sync nicht alte Sequenzen verwendet werden)
  - Config-Einträge mit Key `beleg_counter_%` (Belegzähler pro Kasse/Jahr, siehe [src/db.ts](src/db.ts) Zeile 124: `beleg_counter_${kassenId}_${year}`)
- **Unverändert lassen:**
  - `kassen`, `haendler`, `config` (alle anderen Keys: role, master_ws_url, kassen_id, kassenname, beleg_prefix, join_token, ws_server_port, my_ws_url, etc.), `join_requests`, `schema_migrations`

Reihenfolge der DELETEs wegen FK: zuerst `stornos`, dann `buchungen`, dann `kundenabrechnung`, dann `sync_state`; danach `DELETE FROM config WHERE key LIKE 'beleg_counter_%'`.

### Backend

- Neuer Tauri-Command z. B. `**reset_abrechnungslauf`** in [src-tauri/src/commands.rs](src-tauri/src/commands.rs):
  - Führt die obigen DELETEs und Config-Bereinigung in einer sinnvollen Reihenfolge aus (über bestehende `db::db_path` + rusqlite).
  - Rückgabe: `Result<(), String>` oder eine kurze Erfolgsmeldung.

### Frontend

- **Ort:** Einstellungen (für Master und/oder alle Kassen). Ein zentraler Platz reicht, da alle Kassen den gleichen Reset brauchen können.
- **UI:** Abschnitt „Neuer Abrechnungslauf“ mit kurzer Erklärung („Alle Kundenabrechnungen und Buchungen werden gelöscht. Händlerliste und Kassen-Einrichtung bleiben erhalten.“) und Button „Abrechnungslauf zurücksetzen“.
- **Sicherheit:** Bestätigungsdialog (z. B. „Wirklich alle Buchungen löschen und neuen Abrechnungslauf starten?“) vor dem Aufruf von `reset_abrechnungslauf`.
- **Nach dem Reset:** Kurze Erfolgsmeldung; optional Startseite oder Kasse neu laden.

### Sync-Hinweis

- Nach dem Reset haben alle Kassen leere `kundenabrechnung`/`buchungen`/`sync_state`. Beim nächsten Sync werden keine alten Daten mehr nachgezogen. Belegnummern starten mit 001 (weil Belegzähler gelöscht). Kein Änderung am Sync-Protokoll nötig.

---

## 3. Kurzüberblick


| Thema           | Änderung                                                                                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sync-Status** | In `handle_sync_connection` (server.rs) beim Öffnen der Verbindung `set_connected(peer_id, true)`, beim Schließen `set_connected(peer_id, false)`. App-Handle ist vorhanden, `SyncStatusState` per `try_state` nutzbar. |
| **Reset**       | Neuer Command `reset_abrechnungslauf`: DELETEs für stornos, buchungen, kundenabrechnung, sync_state; Config-Keys `beleg_counter_%` löschen. Händler/Kassen/übrige Config bleiben.                                       |
| **Reset UI**    | Einstellungen: Bereich „Neuer Abrechnungslauf“, Bestätigungsdialog, Button ruft `reset_abrechnungslauf` auf.                                                                                                            |


---

## 4. Betroffene Dateien

- [src-tauri/src/sync/server.rs](src-tauri/src/sync/server.rs) – `handle_sync_connection`: am Anfang `set_connected(peer_id, true)`, am Ende (vor `remove`) `set_connected(peer_id, false)`; `SyncStatusState` und `AppHandle` sind verfügbar.
- [src-tauri/src/commands.rs](src-tauri/src/commands.rs) – neuer Command `reset_abrechnungslauf`; in `lib.rs` registrieren.
- [src/db.ts](src/db.ts) – neue Funktion `resetAbrechnungslauf()` (invoke des Commands).
- [src/components/EinstellungenView.tsx](src/components/EinstellungenView.tsx) – neuer Abschnitt „Neuer Abrechnungslauf“ mit Bestätigung und Button.

