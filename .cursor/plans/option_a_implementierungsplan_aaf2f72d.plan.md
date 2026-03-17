---
name: Option A Implementierungsplan
overview: "Detaillierter Implementierungsplan für das Kassensystem mit Option A: Tauri 2, SQLite, eigenes WebSocket-Sync, Master-Kasse als Anlaufpunkt für Anmeldung und Sync."
todos: []
isProject: false
---

# Implementierungsplan Option A: Tauri + SQLite + eigenes Sync

## Stack (festgelegt)

- **Desktop**: [Tauri 2](https://v2.tauri.app/) (Rust Backend, WebView Frontend)
- **Datenbank**: SQLite über [Tauri Plugin SQL](https://v2.tauri.app/plugin/sql) (Migrationen unterstützt)
- **Frontend**: z. B. React oder Vue (TypeScript) – eine Codebasis für alle Kassen
- **Sync-Transport**: WebSockets (einfacher als WebRTC für LAN, gleiche App kann Server und Client)
- **Master-Kasse**: Hört als WebSocket-Server auf einem konfigurierbaren Port; alle anderen verbinden sich zuerst dorthin

---

## Projektstruktur (Vorschlag)

```
kassensystem/
├── src-tauri/           # Rust
│   ├── migrations/      # SQL-Dateien (001_initial.sql, …)
│   ├── src/
│   │   ├── main.rs
│   │   ├── db/          # Schema, Migrationen, Zugriff, config
│   │   ├── sync/        # WebSocket Server, Client, Protokoll
│   │   └── lib.rs
│   └── Cargo.toml
├── src/                 # Frontend (React/Vue)
│   ├── components/      # Kundenabrechnung erfassen (1-n Positionen), Abrechnung, Händlerverwaltung (Master), Sync-Status, Master: Anmeldeanfragen
│   ├── stores/          # Zustand (z. B. aktuelle Kasse, Verbindungen)
│   └── ...
├── package.json
└── README.md
```

- **Eine Codebasis**: Ob Master oder Slave wird zur Laufzeit durch Konfiguration bestimmt („diese Kasse ist Master“ + ggf. „Master-Adresse“ für Slaves).

---

## Datenbankschema (SQLite)

**Tabelle `kassen`** (Stammdaten der bekannten Kassen in diesem Verbund)


| Spalte       | Typ        | Beschreibung                                                           |
| ------------ | ---------- | ---------------------------------------------------------------------- |
| id           | TEXT PK    | Eindeutige Kassen-ID (UUID oder fest)                                  |
| name         | TEXT       | Anzeigename (z. B. "Stand 1")                                          |
| person1_name | TEXT       | Aktuelle erste Person am Kassenplatz (ändert sich bei Schichtwechsel)  |
| person2_name | TEXT       | Aktuelle zweite Person am Kassenplatz (ändert sich bei Schichtwechsel) |
| is_master    | INTEGER    | 1 = Master-Kasse, 0 = normale Kasse                                    |
| created_at   | TEXT (ISO) | Erstellzeitpunkt                                                       |


- Pro Kassenplatz sind **zwei Personen** hinterlegt. Wegen **Zeitplänen/Schichten** kann sich diese Besetzung **während eines Abrechnungszeitraums ändern**; die Felder auf `kassen` sind die **aktuelle** Besetzung (bei Einrichtung gesetzt, bei Schichtwechsel anpassbar). Optional leer.

**Tabelle `haendler`** (Verwaltung der Händler mit ihren Nummern – Stammdaten)


| Spalte         | Typ     | Beschreibung                                                  |
| -------------- | ------- | ------------------------------------------------------------- |
| haendlernummer | TEXT PK | Eindeutige Händlernummer (wie auf Preisschild)                |
| name           | TEXT    | Bezeichnung/Name des Händlers (z. B. für Anzeige, Abrechnung) |
| optional: sort | INTEGER | Sortierung in Listen                                          |


- Die **Händlerliste** wird auf der **Master-Kasse** gepflegt (anlegen, bearbeiten, löschen). Beim **Setup/Join** einer Slave-Kasse überträgt die Master-Kasse diese Liste an die neue Kasse, damit alle Kassen dieselben Händlernummern und -namen haben (z. B. für Auswahl in der Kasse, Abrechnungsauswertung). Optional: Änderungen an der Händlerliste können später auch an bereits verbundene Slaves gepusht werden.

**Modell: Kundenabrechnung = 1 Kunde, 1–n Produkte verschiedener Händler**

Eine **Kundenabrechnung** an der Kasse erfasst 1–n Produkte (unterschiedliche Händler, unterschiedliche Preise), die zu einem Beleg zusammengefasst werden. Pro Kunde/Vorgang entsteht genau eine Kundenabrechnung; jede Zeile ist eine Position (ein Produkt mit Händlernummer und Preis).

**Tabelle `kundenabrechnung`** (ein Beleg pro Kunden-Vorgang, append-only)


| Spalte       | Typ        | Beschreibung                                                       |
| ------------ | ---------- | ------------------------------------------------------------------ |
| id           | TEXT PK    | Eindeutige ID (UUID)                                               |
| kassen_id    | TEXT       | Kasse, an der abgerechnet wurde (FK → kassen.id)                   |
| person1_name | TEXT       | Erste Person an der Kasse zum Zeitpunkt der Abrechnung (Snapshot)  |
| person2_name | TEXT       | Zweite Person an der Kasse zum Zeitpunkt der Abrechnung (Snapshot) |
| zeitstempel  | TEXT (ISO) | Zeitpunkt der Kundenabrechnung                                     |
| belegnummer  | TEXT       | Automatisch vergeben: Prefix-Jahr-NNN (Prefix in config)           |
| sequence     | INTEGER    | Monotone Sequenz pro kassen_id (für Sync)                          |


**Tabelle `buchungen`** (Positionen pro Kundenabrechnung – 1-n pro Beleg)


| Spalte                | Typ     | Beschreibung                                           |
| --------------------- | ------- | ------------------------------------------------------ |
| id                    | TEXT PK | Eindeutige Positions-ID (UUID)                         |
| kundenabrechnung_id   | TEXT    | Zugehörige Kundenabrechnung (FK → kundenabrechnung.id) |
| haendlernummer        | TEXT    | Händlernummer vom Preisschild                          |
| betrag                | REAL    | Preis dieser Position (z. B. in Euro)                  |
| optional: bezeichnung | TEXT    | z. B. Artikel/Produktbezeichnung                       |


- **Zusammenhang**: Eine Kundenabrechnung hat viele Buchungen (Positionen). Kasse und Personen stehen auf der Kundenabrechnung; jede Position trägt Händlernummer und Betrag. Händler-Abrechnung = Summe aller `buchungen.betrag` gruppiert nach `haendlernummer` (über alle Kundenabrechnungen).
- **Sync**: Pro `kassen_id` wird die letzte `sequence` in `kundenabrechnung` geführt. Beim Sync werden fehlende **Kundenabrechnungen** inkl. aller zugehörigen **Buchungen** (Positionen) ausgetauscht – immer vollständige Belege. Duplikate: `ON CONFLICT(id) DO NOTHING` auf beiden Tabellen.

**Tabelle `sync_state`** (Sync-Metadaten pro bekanntem Peer)


| Spalte         | Typ     | Beschreibung                                                |
| -------------- | ------- | ----------------------------------------------------------- |
| peer_kassen_id | TEXT PK | Kassen-ID des anderen Knotens                               |
| last_sequence  | INTEGER | Letzte bekannte `kundenabrechnung.sequence` für diese Kasse |
| updated_at     | TEXT    | Zeitpunkt des letzten Sync mit diesem Peer                  |


**Tabelle `join_requests`** (nur auf Master-Kasse relevant)


| Spalte     | Typ     | Beschreibung               |
| ---------- | ------- | -------------------------- |
| id         | TEXT PK | Eindeutige Request-ID      |
| kassen_id  | TEXT    | Anfragende Kasse           |
| name       | TEXT    | Angegebener Name der Kasse |
| status     | TEXT    | 'pending'                  |
| created_at | TEXT    | Zeitstempel                |


- Nach Freigabe: Master trägt die Kasse in `kassen` ein und sendet an die neue Kasse: **Peer-Liste** (alle bekannten `kassen` inkl. Adressen) und die **Händlerliste** (`haendler`). Die neue Kasse speichert Peers und Händler und startet Sync mit allen.

**Tabelle `config`** (Konfiguration – persistent in SQLite)


| Spalte | Typ     | Beschreibung                                                                                                                             |
| ------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| key    | TEXT PK | Einstellungsschlüssel (z. B. role, master_address, kassen_id, sync_port, sync_url, kassenname, master_ws_port, beleg_prefix, join_token) |
| value  | TEXT    | Wert (String). Für Zähler: beleg_counter__ → letzte NNN.                                                                                 |


- Defaults beim Erststart: z. B. beleg_prefix = "BELEG" wenn nicht gesetzt. **Einstellungsseite** in der App für Master-Adresse, Port, Kassenname, Personen, Beleg-Prefix etc.

**Belegnummer (automatisch)**

- **Automatisch** pro Kasse **fortlaufend**. Format: **Prefix-Jahr-NNN** (z. B. BELEG-2026-001). Der **Prefix** ist konfigurierbar (in `config`). Pro Kasse eigene Zählerlogik (z. B. nächste freie Nummer pro Jahr).

**Tabelle `stornos`** (Phase 4 – Storno)


| Spalte              | Typ     | Beschreibung                                                      |
| ------------------- | ------- | ----------------------------------------------------------------- |
| id                  | TEXT PK | UUID                                                              |
| buchung_id          | TEXT    | FK → buchungen.id (stornierte Position)                           |
| kundenabrechnung_id | TEXT    | optional; bei Storno ganzer Abrechnung alle Positionen stornieren |
| kassen_id           | TEXT    | Kasse, die storniert hat                                          |
| zeitstempel         | TEXT    | Zeitpunkt des Stornos                                             |


- **Storno**: Einzelne Position oder ganze Kundenabrechnung. Stornos werden zwischen Peers **synchronisiert** (append-only). Abrechnung = Summe Buchungen minus Summe stornierter Beträge pro Händler. Umsetzung in **Phase 4**.

---

## Sync-Protokoll (WebSocket, JSON-Nachrichten)

- **Rahmen:** Jede WebSocket-Nachricht ist ein JSON-Objekt mit Feld `**type`** zur Unterscheidung. Sync-Daten werden **nicht** in `join_approve` mitgeschickt, sondern in separaten Nachrichten danach.
- **Verbindungstopologie (Mesh):** **Jede** Kasse (Master und Slave) betreibt einen WebSocket-Server auf einem Port (konfigurierbar, Default z. B. 8766). Slave sendet in `join_request` ihre **eigene** URL (`my_ws_url`); Master nimmt sie in die Peer-Liste auf und gibt sie in `join_approve` weiter. Slaves verbinden sich zu allen Peer-URLs (außer zur eigenen).
- **Nachrichtentypen und JSON-Formate:**


| type                     | Richtung          | Bedeutung und Felder                                                                                                                                                                              |
| ------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `join_request`           | Slave → Master    | kassen_id, name, **my_ws_url** (unter der diese Kasse erreichbar ist), **token** (Join-Token vom Master). Master prüft Token, speichert Request in join_requests, zeigt in UI.                    |
| `join_approve`           | Master → Slave    | peers: [{ kassen_id, name, ws_url }], haendler: [{ haendlernummer, name, sort? }]. Kein initialer Daten-Sync in dieser Nachricht – Sync läuft danach in separaten Nachrichten.                    |
| `join_reject`            | Master → Slave    | reason?: string                                                                                                                                                                                   |
| `sync_state`             | bidirektional     | state: { [kassen_id]: last_sequence }. Beispiel: `{ "type": "sync_state", "state": { "uuid-1": 42, "uuid-2": 17 } }`                                                                              |
| `kundenabrechnung_batch` | A → B             | items: [{ kundenabrechnung: {...}, buchungen: [{...}, ...] }]. Pro Beleg ein Eintrag mit Kundenabrechnung und Array Buchungen.                                                                    |
| `ack`                    | B → A             | peer_kassen_id: string, last_sequence: number                                                                                                                                                     |
| `haendler_list_update`   | Master → Slave(n) | haendler: [{ haendlernummer, name, sort? }]. Komplette Liste; Slave ersetzt lokale Tabelle haendler. Bei Änderung auf Master an alle verbundenen Slaves; beim Reconnect mit Master erneut senden. |
| `error`                  | bidirektional     | code: string, message: string. Für Protokollfehler.                                                                                                                                               |


- **Join-Token (Absicherung):** Master generiert einen Token (Anzeige in UI, z. B. zum Kopieren). Slave muss diesen Token bei „Netz beitreten“ eingeben und in `join_request` mitschicken. Master akzeptiert nur Anfragen mit gültigem Token. (Details: einmalig pro Join vs. wiederverwendbar bei Implementierung festlegen.)
- **Ablauf zwischen zwei Peers (nach Join)**:
  1. A und B verbunden (WebSocket).
  2. A sendet `sync_state` (state: Map kassen_id → letzte sequence).
  3. B vergleicht mit eigenem Stand, sendet `kundenabrechnung_batch` mit items (pro fehlender Kundenabrechnung ein Eintrag: kundenabrechnung + buchungen). Umgekehrt genauso.
  4. Beide fügen ein: zuerst kundenabrechnung, dann buchungen (ON CONFLICT DO NOTHING); aktualisieren sync_state für den Partner, senden `ack`.
- **Duplikate**: Primärschlüssel auf kundenabrechnung.id und buchungen.id (UUIDs); INSERT mit Konfliktbehandlung.

---

## Master-Kasse: Ablauf konkret

1. **Erststart / Initial-Setup** (nur einmal, auf der Kasse die Master werden soll):
  - App fragt: „Als Master-Kasse einrichten?“ → Ja → eigene `kassen`-Zeile anlegen (id, name, is_master=1), WebSocket-Server starten (Port z. B. 8765), in Konfiguration speichern („Ich bin Master“, „Server: 0.0.0.0:8765“). Die Master-Kasse verwaltet die **Händlerliste** (`haendler`); neue Slaves erhalten diese Liste beim Join.
  - Andere Kassen kennen die Master-Adresse (z. B. `ws://192.168.1.10:8765`) durch manuelle Eingabe oder spätere Konfiguration.
2. **Neue Kasse will beitreten**:
  - **Master**: Join-Token generieren (in UI anzeigen, z. B. zum Kopieren). Slave muss diesen Token kennen.
  - Auf der neuen Kasse: Einstellungsseite – Master-Adresse, **Join-Token** eingeben, eigene Sync-URL/Port (konfigurierbar, Default z. B. 8766). „Netz beitreten“ → Verbindung als WebSocket-Client zur Master-Adresse.
  - Senden: `join_request` mit `kassen_id`, `name`, `my_ws_url`, **token**.
  - Master: Token prüfen; bei gültigem Token Eintrag in `join_requests` (status=pending), Anzeige in der UI (z. B. „Kasse ‚Stand 2‘ möchte beitreten – [Annehmen] [Ablehnen]“).
  - Bei **Annehmen**: Master fügt die Kasse in `kassen` ein, sendet `join_approve` mit **Peer-Liste** (alle `kassen` inkl. ws_url) und **Händlerliste**. Neue Kasse speichert Peers und Händler, baut Verbindungen zu allen anderen auf und startet Sync in separaten Nachrichten (sync_state + kundenabrechnung_batch mit jedem Peer).
3. **Laufender Betrieb**:
  - Alle Kassen (Master inkl.) sind gleichberechtigte Sync-Partner; Kundenabrechnungen und Buchungen (Positionen) werden untereinander ausgetauscht. Die Master-Rolle wird nur für Join/Leave und das Hosten des WebSocket-Servers benötigt. **Händlerliste**: Bei Änderung auf Master wird `haendler_list_update` an alle verbundenen Slaves gesendet; beim Reconnect mit Master sendet Master die aktuelle Händlerliste erneut.

---

## Frontend: Ansichten und Navigation

- **Haupt-Ansichten**: Kasse (Kundenabrechnung erfassen, Besetzung), Abrechnung (Händler-Summen, Filter), Sync-Status, Einstellungen (Kassenname, Personen, Master-Adresse, Sync-URL/Port, Rolle, Beleg-Prefix, Join-Token bei Master). **Nur Master**: Händlerverwaltung (CRUD), Join-Anfragen (Annehmen/Ablehnen).
- **Navigation**: **Startseite mit Tiles/Karten** pro Bereich (nicht Tabs/Sidebar).
- **Rollen**: **Slave** – Händlerliste nur lesbar (z. B. Dropdown bei Erfassung), keine Händlerverwaltung, keine Join-Anfragen. **Master** – alle Ansichten inkl. Händlerverwaltung und Join-Anfragen.

---

## Fehlerbehandlung und Reconnect

- **Verbindungsabbruch**: In der UI anzeigen „Getrennt von [Peer]“. Lokale Erfassung weiter möglich; Sync-Queue läuft beim nächsten Verbindungsaufbau. **Automatischer Reconnect** mit Retry (z. B. Intervall und ggf. Backoff bei Implementierung festlegen).
- **Master ausgefallen**: Bereits bekannte Peers bleiben verbunden; **Sync zwischen Slaves läuft weiter**. Neue Kassen können erst wieder joinen, wenn der Master wieder da ist.
- **Zentrale Anzeige**: Sync-Status (z. B. „Verbunden mit 2 von 3 Kassen“) in der UI.

---

## Datenbank-Migrationen

- **Migrationen** als **SQL-Dateien** im Projekt (z. B. `src-tauri/migrations/001_initial.sql`, `002_...sql`). **Schema-Version** in Tabelle `**schema_migrations`** (z. B. Spalte version bzw. name, ggf. angewendet_am). Beim **App-Start**: Prüfen, welche Migrationen noch nicht angewendet sind; diese der Reihe nach ausführen.

---

## Tests

- **Unit-Tests**: Sync-Logik (z. B. Berechnung fehlender Kundenabrechnungen aus sync_state, Merge ohne Duplikate); Abrechnungs-Aggregation (Summe pro Händler, mit/ohne Storno).
- **Integrationstest**: Zwei Instanzen (z. B. zwei Prozesse/DBs) – Join durchspielen, Kundenabrechnung auf einer erfassen, Sync auslösen, auf der anderen prüfen, dass Daten ankommen.
- **UI-/E2E-Tests**: Gewünscht (bei Implementierung einplanen).

---

## Phasen der Umsetzung

### Phase 1: Tauri-Projekt + SQLite + lokale Kasse (ohne Sync)

- Tauri-2-Projekt anlegen, Plugin SQL (SQLite) einbinden, Frontend-Grundgerüst (z. B. React + TypeScript).
- Schema anlegen: Migrationen für `kassen`, `haendler`, `kundenabrechnung`, `buchungen`, `sync_state`, `join_requests`, `config`, `schema_migrations`. (Tabelle `stornos` in Phase 4.)
- **Erststart**: Wenn keine Konfiguration/kassen existieren → Dialog „Als Master einrichten?“ oder „Netz beitreten“. **Einstellungsseite** anbieten (Master-Adresse, Sync-Port/URL, Kassenname, Personen etc.). Bei Master: eine Zeile in `kassen` anlegen (is_master=1), Config speichern. Bei „Netz beitreten“: Kassen-ID (UUID) selbst vergeben, Kassenname und zwei Personen in `kassen` anlegen.
- **Kundenabrechnung erfassen**: UI: 1–n Positionen (Händlernummer + Betrag, optional Bezeichnung; Händlerauswahl aus Liste falls vorhanden). Beim Abschließen: eine Zeile in `kundenabrechnung` (id, kassen_id, person1_name/person2_name aus Kassen-Besetzung, zeitstempel, **belegnummer** automatisch nach Format Prefix-Jahr-NNN, sequence); für jede Position eine Zeile in `buchungen`.
- **Besetzung bei Schichtwechsel anpassen**: In der Kassen-UI die beiden Personen-Namen änderbar (Update `kassen.person1_name`, `kassen.person2_name`). Ab der nächsten Kundenabrechnung gelten die neuen Namen; vergangene Belege behalten ihren Snapshot.
- **Abrechnungsansicht (Händler)**: Über alle `buchungen` gruppiert nach `haendlernummer`, Summe `betrag`; optional Filter nach Zeitraum, Kasse (über kundenabrechnung.kassen_id) oder Personen. Kann auf jeder synchronisierten Kasse laufen.

**Phase 1 – ergänzende Festlegungen (damit nichts fehlt):**

- **Tabelle `config` – Schema:** Key-Value: `config(key TEXT PRIMARY KEY, value TEXT)`. Beim Erststart Defaults setzen (z. B. `beleg_prefix` = "BELEG", wenn nicht gesetzt). Keys z. B.: role, master_address, kassen_id, sync_port, sync_url, kassenname, master_ws_port (Master), beleg_prefix.
- **Tabelle `schema_migrations`:** z. B. `(version TEXT PRIMARY KEY, applied_at TEXT)` – in erster Migration anlegen; danach Tabellen kassen, haendler, config, kundenabrechnung, buchungen, sync_state, join_requests. Reihenfolge in 001_initial.sql so, dass keine FK verletzt wird (kassen vor kundenabrechnung).
- **Belegnummer-Zähler:** Nächste Nummer pro Kasse und Jahr in `config`: Key `beleg_counter_<kassen_id>_<jahr>`, Value = letzte NNN. Beim Erzeugen: Wert lesen, inkrementieren, zurückschreiben; Format `<prefix>-<jahr>-<NNN>` (NNN 3-stellig: 001, 002, …). Default-Prefix aus config, falls leer "BELEG".
- **sequence bei Kundenabrechnung:** Beim Anlegen `sequence = COALESCE(MAX(sequence), 0) + 1` für diese kassen_id (für späteren Sync). In Phase 1 bereits so setzen.
- **UI in Phase 1:** Startseite mit Tiles nur für: **Kasse**, **Abrechnung**, **Einstellungen**. Kein Sync-Status, keine Händlerverwaltung, keine Join-Anfragen (Phase 2). Händlerliste in Phase 1 leer – Erfassung mit **freier Händlernummer-Eingabe**.

Ziel: Eine Kasse kann lokal buchen und Abrechnung anzeigen; keine Netzwerkfunktion.

### Phase 2: Master WebSocket-Server + Join-Request / Join-Approve + Händlerliste + Join-Token

- Auf der Master-Kasse: WebSocket-Server starten, Port aus Config. **Join-Token** generieren und in UI anzeigen (z. B. zum Kopieren); Slave muss Token bei „Netz beitreten“ eingeben.
- **Händlerverwaltung (Master)**: UI zum Verwalten der Händlerliste (CRUD in `haendler`). Liste wird beim Join an Slave-Kassen übertragen; bei Änderung `**haendler_list_update`** an alle verbundenen Slaves senden (komplette Liste).
- Nachrichten `join_request` (mit kassen_id, name, my_ws_url, **token**), `join_approve` (peers, haendler), `join_reject` implementieren. Master prüft Token; speichert gültige Requests in `join_requests`, UI: ausstehende Anfragen, „Annehmen“/„Ablehnen“. `**join_approve`** enthält Peer-Liste (inkl. ws_url) und Händlerliste; Sync-Daten in separaten Nachrichten danach.
- Slave-Seite: Einstellungen (Master-Adresse, **Join-Token**, eigene Sync-URL/Port). Verbindung als WebSocket-Client, `join_request` mit my_ws_url und token senden; bei `join_approve` Peers und Händler lokal speichern, Verbindungen zu allen Peers aufbauen. Beim Reconnect mit Master: Master sendet aktuelle Händlerliste (z. B. haendler_list_update).

Ziel: Neue Kasse kann sich bei der Master anmelden und wird freigegeben; noch kein Sync von Kundenabrechnungen/Buchungen.

### Phase 3: Sync-Protokoll (Kundenabrechnungen und Positionen austauschen)

- Nachrichten `sync_state`, `kundenabrechnung_batch`, `ack` implementieren.
- Beim Verbinden mit einem Peer: gegenseitig `sync_state` senden (letzte kundenabrechnung.sequence pro kassen_id), fehlende Kundenabrechnungen inkl. zugehöriger Buchungen (Positionen) ermitteln, `kundenabrechnung_batch` senden; beim Empfänger zuerst Kundenabrechnungen, dann Buchungen einfügen (ON CONFLICT DO NOTHING), `sync_state` aktualisieren.
- Regelmäßig oder bei neuen lokalen Kundenabrechnungen: Sync mit allen verbundenen Peers anstoßen (incremental: nur neue Belege seit last_sequence).
- **Sync-Queue**: Wenn keine Verbindung: neue Kundenabrechnungen (mit Positionen) nur lokal speichern; beim nächsten Verbindungsaufbau Sync ausführen (gleiches Protokoll). Optional: Hintergrund-Retry bis alle Peers bedient sind.

Ziel: Alle verbundenen Kassen haben denselben Datenstand (Kundenabrechnungen + Buchungen); Händler-Abrechnung ist auf jeder Kasse nach Sync konsistent.

### Phase 4: Robustheit + UX + Storno

- **Sync-Status in der UI**: Verbunden/Getrennt pro Peer, letzter Sync-Zeitpunkt, Fehleranzeige; **zentrale Anzeige** (z. B. „Verbunden mit 2 von 3 Kassen“). Bei Abbruch: „Getrennt von [Peer]“ anzeigen, **automatischer Reconnect** mit Retry. Wenn Master ausgefallen: Slaves syncen untereinander weiter.
- **Master-UI**: Liste der verbundenen Kassen, ausstehende Join-Requests, Händlerverwaltung, ggf. „Kasse entfernen“. Händlerliste-Änderungen per `haendler_list_update` an alle Slaves pushen.
- **Konfiguration**: Alle Einstellungen in SQLite (`config`); Einstellungsseite (Master-Port, Kassen-ID/Name, Master-Adresse, Sync-URL/Port, Beleg-Prefix, Join-Token).
- **Storno**: Tabelle `stornos` (id, buchung_id, kundenabrechnung_id?, kassen_id, zeitstempel). Storno **einzelner Position** oder **ganzer Kundenabrechnung**; Stornos zwischen Peers synchronisieren (append-only). Abrechnung = Summe Buchungen minus Summe stornierter Beträge pro Händler.

---

## Wichtige Dateien / Stellen (Orientierung)

- **Migrationen**: SQL-Dateien in `src-tauri/migrations/` (z. B. 001_initial.sql); Schema-Version in Tabelle `schema_migrations`; beim Start ausstehende Migrationen ausführen. Optional Anbindung über [Tauri SQL Plugin](https://v2.tauri.app/plugin/sql).
- **WebSocket Server**: `src-tauri/src/sync/server.rs`, nur aktiv wenn Master; Bindung an `0.0.0.0:PORT`. Jede Kasse (auch Slave) hat einen Server für eingehende Peer-Verbindungen (Mesh).
- **WebSocket Client & Protokoll**: `src-tauri/src/sync/client.rs`, `protocol.rs` (Nachrichtentypen inkl. type, join_request/join_approve/sync_state/kundenabrechnung_batch/ack/haendler_list_update/error; Serialisierung JSON).
- **Commands (Tauri)**: z. B. `create_kundenabrechnung` (mit 1–n Positionen, Belegnummer automatisch), `get_abrechnung`, `get_sync_status`, `join_network` (mit token), `approve_join_request` (Master), `get_join_token` (Master), Config lesen/schreiben.

---

## Offene Punkte (kurz)

- **Join-Token**: Einmalig pro Join oder wiederverwendbar/regenerierbar – bei Implementierung festlegen.
- **Frontend-Framework**: React oder Vue – Geschmackssache; TypeScript empfohlen.
- **Reconnect**: Retry-Intervall und Backoff bei Implementierung konkretisieren.

Die Detailplanung (alle 12 Schritte) ist in [detailplanung_step_by_step.md](detailplanung_step_by_step.md) festgehalten. Nächster Schritt: Phase 1 konkret ausformulieren (z. B. `npm create tauri-app`, erste Tabellen-SQL, Beispiel-UI mit Tiles).