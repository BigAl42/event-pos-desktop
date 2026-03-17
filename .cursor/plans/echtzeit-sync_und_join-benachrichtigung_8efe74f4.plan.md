---
name: Echtzeit-Sync und Join-Benachrichtigung
overview: Sync automatisch beim Start starten und periodisch abgleichen (Echtzeit-Nähe); bei neuer Join-Anfrage auf der Master-Kasse eine System-Benachrichtigung (Growl/OS-Notification) anzeigen.
todos: []
isProject: false
---

# Echtzeit-Sync und Join-Benachrichtigung

## 1. Sync automatisch starten und zeitnah halten

### Ist-Zustand

- Sync wird nur nach Klick auf „Sync zu Peers starten“ / „Sync starten“ in den Einstellungen gestartet ([commands.rs](src-tauri/src/commands.rs) `start_sync_connections`).
- Danach laufen die WebSocket-Verbindungen im Hintergrund (mit Reconnect). Daten werden ausgetauscht, wenn eine Seite `SyncState` sendet (beim Verbindungsaufbau oder wenn die andere Seite etwas schickt). **Neue** Kundenabrechnungen auf Kasse A werden erst bei der nächsten „SyncState-Runde“ zu B übertragen – es gibt kein aktives periodisches Anstoßen.

### Gewünscht

- **Kein manueller Klick nötig:** Sync-Verbindungen automatisch starten, sobald die App geladen ist und Peers konfiguriert sind (Master oder Slave mit mindestens einem Peer).
- **Möglichst Echtzeit:** Neuen Daten zeitnah abgleichen, ohne dass der Nutzer etwas tun muss.

### Umsetzung

**A) Auto-Start der Sync-Verbindungen**

- **Ort:** Frontend, zentral beim App-Start (z. B. in [App.tsx](src/App.tsx)), sobald `setupDone === true` und die App sichtbar ist.
- **Logik:** Einmalig (z. B. in einem `useEffect` mit leerem Dependency-Array oder mit `[setupDone]`):
  - Rolle ermitteln (`getConfig("role")`).
  - Wenn `role === "master"` oder `role === "slave"`: prüfen, ob überhaupt Peers existieren – z. B. `getSyncStatus()` aufrufen; wenn die Liste leer ist, könnte man optional trotzdem `startSyncConnections()` aufrufen (Backend meldet dann „0 Peers“), oder eine kleine Hilfsfunktion/Command nutzen, der „hat Peers?“ zurückgibt.
  - Wenn Peers da sind (oder immer bei Master/Slave): `startSyncConnections()` aufrufen. Fehler abfangen und ggf. still ignorieren oder einmal loggen (z. B. „Sync konnte nicht gestartet werden“), damit der Start der App nicht blockiert.
- **Hinweis:** Beim Master muss ggf. vorher der WebSocket-Server laufen – der wird aktuell mit „Server starten“ gestartet. Wenn der Master nur über Einstellungen geöffnet wird und noch nicht „Server starten“ geklickt hat, schlägt `startSyncConnections()` ggf. teilweise fehl (Server für Slaves wird trotzdem gestartet). Das ist akzeptabel; Nutzer muss weiterhin einmal „Server starten“ auf dem Master ausführen. Optional könnte man später beim Master zusätzlich automatisch den Server starten, wenn gewünscht.

**B) Periodisches Anstoßen des Abgleichs (Echtzeit-Nähe)**

- **Idee:** In der bestehenden Sync-Schleife (sowohl im **Client** [client.rs](src-tauri/src/sync/client.rs) als auch im **Server** [server.rs](src-tauri/src/sync/server.rs)) alle N Sekunden (z. B. 8–15 Sek) ein `SyncState` an den Peer senden. Der Peer antwortet mit seinem State und ggf. mit `KundenabrechnungBatch`; wir senden ebenfalls Batch, falls wir neuere Daten haben. So propagieren neue Belege innerhalb von wenigen Sekunden ohne Nutzeraktion.
- **Konkret:**
  - **Client (`run_sync_to_peer`):** Neben `read.next()` im `while let`-Loop einen `tokio::time::interval(Duration::from_secs(10))` (oder ähnlich) per `tokio::select!` laufen lassen; beim Tick aktuelle `sync_db::get_sync_state_map` holen, `Message::SyncState(our_state)` bauen und über `write.send(...)` schicken.
  - **Server (`handle_sync_connection`):** Im bestehenden `loop { tokio::select! { ... } }` einen weiteren Zweig für ein periodisches Intervall (z. B. 10 Sek); beim Tick gleiches Vorgehen: aktuelles SyncState senden.
- **Ergebnis:** Neue Kundenabrechnungen/Stornos erscheinen auf den anderen Kassen innerhalb von typisch 10–15 Sekunden, ohne dass jemand „Sync starten“ oder etwas anderes klicken muss.

---

## 2. System-Benachrichtigung bei neuer Join-Anfrage (Master)

### Ist-Zustand

- Eine Slave-Kasse sendet `join_request` an den Master; der Master speichert in [server.rs](src-tauri/src/sync/server.rs) in `join_requests` und wartet auf Freigabe/Ablehnung. Die Anzeige erfolgt nur in der Ansicht „Join-Anfragen“ – der Nutzer muss diese Ansicht öffnen, um neue Anfragen zu sehen.

### Gewünscht

- Sobald eine neue Join-Anfrage eingeht, soll auf der **Master-Kasse** eine **Growl-artige System-Benachrichtigung** (Desktop-Notification) erscheinen, z. B. „Kasse [Name] möchte beitreten“.

### Umsetzung

**A) Backend: Event auslösen**

- In [server.rs](src-tauri/src/sync/server.rs) in `handle_connection`, direkt **nach** dem erfolgreichen `INSERT` in `join_requests` (Zeile ~191–194), das `AppHandle` nutzen und ein Tauri-Event an das Frontend senden:
  - `app.emit("join-request-received", payload)` mit einem Payload z. B. `{ name: String, kassen_id: String }` (oder als struct, das serde serialisiert wird).
- So wird jede neue Join-Anfrage einmalig an alle geöffneten Fenster/Frontend-Instanzen gemeldet.

**B) Tauri-Plugin für System-Benachrichtigungen**

- **Plugin:** [tauri-plugin-notification](https://v2.tauri.app/plugin/notification) (Tauri 2) einbinden:
  - In [Cargo.toml](src-tauri/Cargo.toml) die Dependency `tauri-plugin-notification` hinzufügen.
  - Im [lib.rs](src-tauri/src/lib.rs) das Plugin registrieren (`.plugin(tauri_plugin_notification::init())` oder laut aktueller Plugin-Doku).
  - Im Frontend (package.json) `@tauri-apps/plugin-notification` installieren; in den Tauri-Capabilities ggf. die Notification-Berechtigung erlauben (falls v2 das verlangt).
- **Frontend:** Nur wenn die aktuelle Kasse **Master** ist:
  - Beim Mount der App (oder einer zentralen Layout-Komponente) einen Listener für das Backend-Event registrieren: `listen("join-request-received", (event) => { ... })`.
  - Im Handler Payload auslesen (z. B. `event.payload.name`) und die Notification anzeigen:
    - Titel z. B. „Join-Anfrage“
    - Body z. B. „Kasse [Name] möchte dem Netz beitreten.“
  - API je nach Plugin: z. B. `import { sendNotification } from '@tauri-apps/plugin-notification'` und `sendNotification({ title: "...", body: "..." })`. Ggf. vorher Berechtigung anfragen, falls die API das vorsieht.

**C) Keine doppelten Notifications**

- Das Event wird nur einmal pro eingehender Verbindung/Join-Request ausgelöst; das reicht. Kein zusätzliches Deduplizieren nötig, solange der Server nur einmal nach dem INSERT emittiert.

---

## 3. Kurzüberblick


| Thema                     | Änderung                                                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sync Auto-Start**       | In App.tsx nach setupDone einmalig bei role master/slave `startSyncConnections()` aufrufen (Fehler abfangen).                                                                                         |
| **Sync periodisch**       | In client.rs und server.rs in der Sync-Schleife alle ~10 s ein `SyncState` senden, damit neue Belege zeitnah ankommen.                                                                                |
| **Join-Benachrichtigung** | In server.rs nach INSERT in join_requests `app.emit("join-request-received", { name, kassen_id })`; Frontend (nur Master) lauscht darauf und zeigt System-Notification via tauri-plugin-notification. |


---

## 4. Betroffene Dateien

- [src/App.tsx](src/App.tsx) – useEffect für Auto-Start Sync (getConfig, getSyncStatus, startSyncConnections).
- [src-tauri/src/sync/client.rs](src-tauri/src/sync/client.rs) – periodisches Senden von SyncState im run_sync_to_peer Loop (tokio::select! mit interval).
- [src-tauri/src/sync/server.rs](src-tauri/src/sync/server.rs) – nach Join-Request INSERT: app.emit("join-request-received", payload); in handle_sync_connection: periodisches SyncState (tokio::select! mit interval).
- [src-tauri/Cargo.toml](src-tauri/Cargo.toml) – tauri-plugin-notification.
- [src-tauri/src/lib.rs](src-tauri/src/lib.rs) – Plugin registrieren.
- Frontend: neue kleine Logik zum Lauschen auf `join-request-received` und Anzeigen der Notification (z. B. in App.tsx oder in einer Hook/Provider-Komponente); package.json + ggf. capabilities für Notification.

---

## 5. Optionale Verfeinerungen

- **Master-Server Auto-Start:** Falls gewünscht, könnte der Master beim App-Start automatisch den WebSocket-Server starten (wie „Server starten“), wenn noch nicht laufend – dann müsste der Nutzer gar nicht mehr in die Einstellungen. Kann in einem zweiten Schritt ergänzt werden.
- **Intervall konfigurierbar:** Das Sync-Intervall (10 s) könnte aus der Config gelesen werden; für den Start reicht ein fester Wert.

