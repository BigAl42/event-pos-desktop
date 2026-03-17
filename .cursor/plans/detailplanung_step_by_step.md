# Detailplanung Step-by-Step

Dieses Dokument führt durch die offenen Planungspunkte in einer festen Reihenfolge. Pro Schritt: Entscheidung/Spezifikation festhalten, dann zum nächsten.

---

## Schritt 1: Sync-Protokoll – Nachrichtenformate (JSON)

**Ziel:** Für jede WebSocket-Nachricht ein klares Format festlegen, damit Implementierung und Tests eindeutig sind.

**Zu klären:**

1. **Rahmen:** Eine WebSocket-Nachricht = ein JSON-Objekt. Soll jedes Objekt ein Feld `type` haben (z. B. `"type": "join_request"`) zur Unterscheidung?
   - [x] Ja, `type` in jeder Nachricht (empfohlen)
   - [ ] Nein, anderes Verfahren: _______________

2. **Feldlisten pro Nachricht** – bitte ausfüllen bzw. bestätigen:

   **`join_request`** (Slave → Master)  
   - `type`: "join_request"  
   - `kassen_id`: string (UUID der anfragenden Kasse)  
   - `name`: string (Anzeigename der Kasse)  
   - `my_ws_url`: string – URL, unter der diese Kasse erreichbar ist (z. B. ws://192.168.1.12:8766).  
   - Weitere Felder: keine

   **`join_approve`** (Master → Slave)  
   - `type`: "join_approve"  
   - `peers`: array of { kassen_id, name, ws_url }  
   - `haendler`: array of { haendlernummer, name [, sort ] }  
   - Soll ein initialer Daten-Sync (Kundenabrechnungen/Buchungen) direkt in dieser Nachricht mitgeschickt werden oder in separaten Nachrichten danach?
   - [x] In separaten Nachrichten danach (einfacher)
   - [ ] Optionales Feld `initial_kundenabrechnungen` in join_approve

   **`join_reject`**  
   - `type`: "join_reject"  
   - `reason`: string (optional)

   **`sync_state`** (bidirektional)  
   - `type`: "sync_state"  
   - `state`: object, Keys = kassen_id, Values = letzte sequence (number).  
     Beispiel: `{ "state": { "kasse-uuid-1": 42, "kasse-uuid-2": 17 } }`  
   - [x] Passt so

   **`kundenabrechnung_batch`** (A → B)  
   - `type`: "kundenabrechnung_batch"  
   - `items`: array of { kundenabrechnung (Objekt), buchungen: array of Buchung-Objekte } – pro Beleg ein Eintrag mit Kundenabrechnung + Array Buchungen.
   - [x] Pro Beleg ein Eintrag mit kundenabrechnung + buchungen
   - [ ] Zwei getrennte Arrays

   **`ack`** (B → A)  
   - `type`: "ack"  
   - `peer_kassen_id`: string (für welche Kasse bestätigt wird)  
   - `last_sequence`: number  
   - Weitere Felder: erstmal keine

3. **Fehler-Nachrichten:** Soll es eine gemeinsame Nachricht `error` geben (z. B. `type: "error", code: string, message: string`) für Protokollfehler?
   - [x] Ja  [ ] Nein  [ ] Später

**Notizen / Entscheidungen:**  
- Alle Entscheidungen oben übernommen. Error-Nachricht: type "error", code (string), message (string).

---

## Schritt 2: Peer-Adressen und Verbindungstopologie

**Ziel:** Klären, wie sich Kassen untereinander verbinden und wie jede Kasse für andere erreichbar ist.

**Zu klären:**

1. **Wer betreibt einen WebSocket-Server?**
   - [ ] Nur die Master-Kasse (alle verbinden sich nur zum Master; Master leitet Sync zwischen Slaves weiter – Hub-Modell)
   - [x] Jede Kasse (Master und jede Slave-Kasse) hat einen eigenen WebSocket-Server auf einem Port. Jeder verbindet sich zu jedem als Client (Mesh).

2. **Falls Mesh (jede Kasse hat Server):**  
   Wie erfährt der Master die Adresse einer Slave-Kasse, um sie in der Peer-Liste weiterzugeben?
   - [x] Die Slave-Kasse sendet in `join_request` ihre eigene URL mit: `my_ws_url`. Master übernimmt sie in die Peer-Liste und gibt sie in `join_approve` weiter.
   - [ ] Andere Idee: _______________

3. **Woher kennt eine Slave-Kasse ihre eigene „Sync-URL“?**  
   (Damit sie sie in join_request mitschicken kann.)
   - [ ] Manuell in Einstellungen eingegeben (IP + Port dieser Maschine)
   - [ ] Automatisch: App startet Server, Anzeige lokale IP, User bestätigt
   - [x] Beides: Konfigurierbar, mit Default (z. B. Port 8766)

4. **Peer-Liste in join_approve:** Enthält für jede Kasse (inkl. Master) genau eine `ws_url`. Slaves verbinden sich zu allen diesen URLs (außer zur eigenen). Passt das?
   - [x] Ja  [ ] Nein: _______________

**Notizen / Entscheidungen:**  
- Mesh-Modell. my_ws_url in join_request; Master gibt Peer-Liste in join_approve weiter. Eigene Sync-URL: konfigurierbar mit Default-Port (z. B. 8766).

---

## Schritt 3: Konfiguration und Persistenz

**Ziel:** Festlegen, wo welche Einstellung gespeichert wird.

**Zu klären:**

1. **Welche Einstellungen müssen persistent sein?**
   - Liste prüfen/ergänzen:
     - [x] Rolle: Master oder Slave
     - [x] Bei Slave: Master-Adresse (Host + Port oder ws://…)
     - [x] Eigene Kassen-ID (UUID)
     - [x] Eigenes Sync-Port (falls Mesh) bzw. eigene Sync-URL
     - [x] Kassenname
     - [x] Master: WebSocket-Server-Port
     - [x] Sonstige: alle genannten

2. **Speicherort:** Wo sollen diese Werte liegen?
   - [x] Alles in SQLite (eigene Tabelle z. B. `config` oder Key-Value in einer Tabelle)
   - [ ] Tauri/System: App-Datenverzeichnis (z. B. JSON-Datei oder SQLite nur für Config)
   - [ ] Gemischt: Kritische/strukturierte Daten in SQLite; Rest in Tauri app_data
   - [ ] Andere Aufteilung: _______________

3. **Erststart:** Wenn noch keine Konfiguration existiert – reicht der bestehende Flow (Dialog „Als Master einrichten?“ / „Netz beitreten“), oder soll es einen expliziten „Einstellungen“-Bereich geben, in dem Master-Adresse / Port / Kassenname vor dem ersten Join gesetzt werden?
   - [ ] Dialog beim Erststart reicht
   - [x] Zusätzlich Einstellungsseite vor erstem Join

**Notizen / Entscheidungen:**  
- Alle genannten Einstellungen persistent. Speicherort: alles in SQLite (z. B. Tabelle config). Zusätzlich Einstellungsseite, damit vor erstem Join Master-Adresse, Port, Kassenname etc. gesetzt werden können.

---

## Schritt 4: Kassen-ID und Erststart (Slave)

**Ziel:** Eindeutig festlegen, wann und wo die Kassen-ID einer Slave-Kasse entsteht.

**Zu klären:**

1. **Wer vergibt die Kassen-ID?**
   - [x] Die Kasse selbst: Beim allerersten Start (vor Join) wird einmalig eine UUID erzeugt und mit Kassenname + Personen gespeichert. Diese ID wird in join_request mitgesendet; der Master übernimmt sie in seine kassen-Tabelle.
   - [ ] Der Master vergibt die ID und sendet sie in join_approve zurück. Slave speichert dann diese ID.

2. **Ablauf Slave „Netz beitreten“ – Reihenfolge bestätigen:**
   - [x] Schritt A: Lokal eine Zeile in `kassen` anlegen (id = neue UUID, name = eingegeben, person1_name, person2_name). Noch keine Peer-Liste.
   - [x] Schritt B: Master-Adresse eingeben, Verbindung aufbauen, join_request senden (kassen_id = diese UUID, name, my_ws_url).
   - [x] Schritt C: Master nimmt an, trägt Kasse in kassen ein (mit derselben kassen_id), sendet join_approve mit Peer-Liste + Händlerliste.
   - [x] Schritt D: Slave speichert Peers und Händler; baut Verbindungen zu allen Peers auf und startet Sync.
   - [x] Passt diese Reihenfolge.

**Notizen / Entscheidungen:**  
- Kassen-ID wird von der Kasse selbst vergeben (UUID beim Erststart). Ablauf A→B→C→D bestätigt.

---

## Schritt 5: Händlerliste – spätere Aktualisierung (Optional)

**Ziel:** Nur relevant, wenn die Händlerliste nach dem Join auf der Master-Kasse geändert werden soll und Slaves aktuell bleiben sollen.

**Zu klären:**

1. **Soll die Master-Kasse Änderungen der Händlerliste an bereits verbundene Slaves pushen?**
   - [ ] Nein – Slaves haben nur den Stand beim Join; bei erneutem Join bekommen sie die neue Liste.
   - [x] Ja – bei jeder Änderung (Hinzufügen/Bearbeiten/Löschen) wird an alle verbundenen Slaves eine Nachricht geschickt.

2. **Falls Ja:** Format der Nachricht?
   - [x] Immer die komplette Liste senden: `haendler_list_update` mit Array aller haendler. Slave ersetzt lokale Tabelle haendler vollständig.
   - [ ] Nur Änderungen (Delta) senden – komplexer. Erstmal nicht.

3. **Slave war offline:** Beim nächsten Verbindungsaufbau (z. B. zu Master): Soll die Händlerliste erneut übertragen werden?
   - [x] Beim Reconnect mit Master: Master sendet aktuelle Händlerliste (z. B. in „welcome“-Nachricht oder separatem haendler_list_update).
   - [ ] Nur beim ersten Join; danach keine automatische Aktualisierung.

**Notizen / Entscheidungen:**  
- Master pusht Händlerliste bei Änderungen an alle verbundenen Slaves. Format: haendler_list_update mit kompletter Liste; Slave ersetzt haendler-Tabelle. Beim Reconnect mit Master: Master sendet aktuelle Händlerliste erneut.

---

## Schritt 6: Storno

**Ziel:** Regeln und Datenmodell für Stornierungen festlegen.

**Zu klären:**

1. **Was kann storniert werden?**
   - [ ] Einzelne Position (eine Buchung innerhalb einer Kundenabrechnung)
   - [ ] Gesamte Kundenabrechnung
   - [x] Beides

2. **Datenmodell:** Wie abbilden?
   - [x] Tabelle `stornos`: id, buchung_id (FK), zeitstempel, kassen_id (wer hat storniert), optional kundenabrechnung_id wenn ganze Abrechnung. Abrechnung = Summe Buchungen minus Summe stornierter Beträge (pro Händler).
   - [ ] Alternative: Storno als negative Buchung oder Flag auf Buchung

3. **Sync:** Sollen Stornos wie Kundenabrechnungen zwischen Peers synchronisiert werden (append-only)?
   - [x] Ja – Stornos werden in allen Kassen repliziert.
   - [ ] Nein / Später

4. **Priorität:** Storno in Phase 1, Phase 4 oder erst nach Go-Live?
   - [ ] Phase 1  [x] Phase 4  [ ] Später

**Notizen / Entscheidungen:**  
- Storno für einzelne Positionen und für ganze Kundenabrechnung. Tabelle stornos (id, buchung_id, zeitstempel, kassen_id, optional kundenabrechnung_id). Stornos werden syncet (append-only). Umsetzung in Phase 4.

---

## Schritt 7: Belegnummer

**Ziel:** Regeln für die Vergabe von belegnummer (optionales Feld auf Kundenabrechnung).

**Zu klären:**

1. **Soll belegnummer automatisch vergeben werden?**
   - [ ] Nein – immer optional, manuell oder leer.
   - [x] Ja – automatisch fortlaufend.

2. **Falls automatisch:** Nach welcher Logik?
   - [x] Pro Kasse fortlaufend (z. B. 1, 2, 3 …).
   - [ ] Global fortlaufend (über alle Kassen).
   - [ ] Andere Regel: _______________

3. **Format:** Frei text (z. B. "BELEG-2025-001") oder nur Zahl?
   - [ ] Nur Zahl  [x] Format: konfigurierbarer Text-Prefix + Jahr + fortlaufende Nummer: `<TEXT>-<JAHR>-<NNN>`, z. B. BELEG-2026-001.

**Notizen / Entscheidungen:**  
- Belegnummer automatisch, pro Kasse fortlaufend. Format: konfigurierbarer Prefix (z. B. BELEG), dann `-<Jahr>-<NNN>` (z. B. BELEG-2026-001). Prefix in Konfiguration (z. B. config-Tabelle).

---

## Schritt 8: Frontend – Ansichten und Rollen

**Ziel:** Bildschirme und Navigation festlegen; wer sieht was.

**Zu klären:**

1. **Welche Haupt-Ansichten soll die App haben?** (Liste bestätigen/ergänzen.)
   - [x] Kasse (Kundenabrechnung erfassen: Positionen hinzufügen, abschließen; Besetzung anzeigen/ändern)
   - [x] Abrechnung (Händler-Abrechnung: Summen pro Händlernummer, Filter Zeitraum/Kasse/Personen)
   - [x] Sync-Status (Verbindungen zu Peers, letzter Sync, Fehler)
   - [x] Einstellungen (Kassenname, Personen, Master-Adresse/Port, eigene Sync-URL, Rolle Master/Slave, ggf. Beleg-Prefix)
   - [x] Nur Master: Händlerverwaltung (Liste Händlernummer + Name, CRUD)
   - [x] Nur Master: Join-Anfragen (ausstehende Anfragen, Annehmen/Ablehnen)
   - [ ] Weitere: _______________

2. **Navigation:** Wie wechselt der User zwischen den Ansichten?
   - [ ] Tabs oben oder seitlich
   - [ ] Sidebar mit Menüpunkten
   - [x] Startseite mit Karten/Tiles pro Bereich
   - [ ] Andere: _______________

3. **Rollen:** Was sieht eine Slave-Kasse, was die Master?
   - [x] Slave: Händlerliste nur lesbar (z. B. Dropdown bei Erfassung), keine Bearbeitung. Keine Händlerverwaltung, keine Join-Anfragen.
   - [x] Master: Alle Ansichten inkl. Händlerverwaltung und Join-Anfragen.
   - Abweichungen: keine

**Notizen / Entscheidungen:**  
- Alle genannten Ansichten. Navigation: Startseite mit Tiles/Karten pro Bereich. Slave: Händler nur lesbar (z. B. bei Erfassung); Master: alle Ansichten inkl. Händlerverwaltung und Join-Anfragen.

---

## Schritt 9: Fehlerbehandlung und Reconnect

**Ziel:** Verhalten bei Verbindungsabbruch und bei Ausfall der Master-Kasse festlegen.

**Zu klären:**

1. **Verbindung bricht ab (z. B. Netzwerk weg):**
   - [x] In der UI anzeigen: „Getrennt von [Peer]“. Lokale Erfassung weiter möglich; Sync-Queue läuft beim nächsten Verbindungsaufbau.
   - [x] Automatischer Reconnect: Ja, mit Retry (z. B. alle 5 s; max. Versuche oder unbegrenzt – bei Implementierung festlegen).
   - [ ] Nein, nur manuell „Verbinden“

2. **Master-Kasse ist ausgefallen:** Dürfen Slave-Kassen untereinander weiter syncen?
   - [x] Ja – bereits bekannte Peers bleiben verbunden; Sync zwischen Slaves läuft weiter. Neue Kassen können erst wieder joinen, wenn Master wieder da ist.
   - [ ] Nein / Andere Regel: _______________

3. **Anzeige:** Soll es eine zentrale Anzeige „Sync-Status“ geben (z. B. „Verbunden mit 2 von 3 Kassen“)?
   - [x] Ja  [ ] Nein

**Notizen / Entscheidungen:**  
- Bei Abbruch: Anzeige „Getrennt von [Peer]“, automatischer Reconnect mit Retry. Master ausgefallen: Slaves syncen untereinander weiter. Zentrale Sync-Status-Anzeige (z. B. „Verbunden mit 2 von 3 Kassen“).

---

## Schritt 10: Sicherheit (optional)

**Ziel:** Entscheiden, ob und welche Absicherung es geben soll.

**Zu klären:**

1. **Join ohne Authentifizierung:** Ist es akzeptabel, dass jede Person im LAN eine Join-Anfrage senden kann und der Master nur per Klick „Annehmen“/„Ablehnen“ entscheidet?
   - [ ] Ja – ausreichend für unser Szenario (vertrauenswürdiges LAN).
   - [x] Nein – wir wollen eine Absicherung (Join-Token).

2. **Falls Absicherung gewünscht:** (kurz skizzieren)
   - [ ] Master-Passwort: Nur wer das Passwort kennt, kann Join-Anfragen annehmen.
   - [x] Join-Token: Master generiert einen Token; Slave muss ihn bei join_request mitschicken. (Bei Implementierung: einmalig pro Join oder wiederverwendbar/regenerierbar festlegen.)
   - [ ] Später planen: _______________

**Notizen / Entscheidungen:**  
- Absicherung gewünscht: Join-Token. Master generiert Token; Slave sendet Token in join_request mit. Details (einmalig vs. wiederverwendbar, Anzeige/Übertragung des Tokens) bei Implementierung klären.

---

## Schritt 11: Datenbank-Migrationen

**Ziel:** Schema-Versionierung und Ablauf beim App-Start festlegen.

**Zu klären:**

1. **Wo liegen die Migrationen?**
   - [x] Als SQL-Dateien im Projekt (z. B. src-tauri/migrations/001_initial.sql, 002_add_haendler.sql).
   - [ ] Im Rust-Code (z. B. tauri-plugin-sql Migration Builder mit include_str! für SQL).
   - [ ] Andere: _______________

2. **Wie wird die aktuelle Schema-Version gespeichert?**
   - [x] Tabelle `schema_migrations` mit Spalte version (oder name) und ggf. angewendet_am.
   - [ ] Vom Tauri-Plugin verwaltet (falls unterstützt).

3. **Reihenfolge beim Start:** App lädt DB → prüft schema_migrations → führt alle noch nicht angewendeten Migrationen der Reihe nach aus. Passt das?
   - [x] Ja  [ ] Nein: _______________

**Notizen / Entscheidungen:**  
- Migrationen als SQL-Dateien (z. B. src-tauri/migrations/). Schema-Version in Tabelle schema_migrations. Beim Start: prüfen, dann ausstehende Migrationen der Reihe nach ausführen.

---

## Schritt 12: Tests

**Ziel:** Festlegen, welche Tests gewünscht sind.

**Zu klären:**

1. **Unit-Tests:** Für welche Bereiche?
   - [x] Sync-Logik (Berechnung „fehlende Kundenabrechnungen“ aus sync_state, Merge ohne Duplikate).
   - [x] Abrechnungs-Aggregation (Summe pro Händler, mit/ohne Storno).
   - [ ] Keine Unit-Tests geplant / Später.

2. **Integrationstest:** Zwei Instanzen (z. B. zwei Prozesse oder zwei DBs), Join durchspielen, Kundenabrechnung auf einer erfassen, Sync auslösen, auf der anderen prüfen, dass Daten ankommen. Gewünscht?
   - [x] Ja  [ ] Nein  [ ] Später

3. **UI-Tests (e2e):** Gewünscht?
   - [x] Ja  [ ] Nein  [ ] Später

**Notizen / Entscheidungen:**  
- Unit-Tests: Sync-Logik und Abrechnungs-Aggregation. Integrationstest: zwei Instanzen, Join + Sync + Datenprüfung. UI-/E2E-Tests: ja.

---

## Abschluss

**Detailplanung abgeschlossen (alle 12 Schritte).**

Nächster Schritt: Entscheidungen in den Implementierungsplan ([option_a_implementierungsplan_aaf2f72d.plan.md](option_a_implementierungsplan_aaf2f72d.plan.md)) übernehmen – z. B. Abschnitte „Sync-Protokoll (JSON-Detail)“, „Konfiguration (config-Tabelle)“, „Join-Token“, „Belegnummer-Format“, „Storno (Phase 4)“, „Frontend (Tiles, Rollen)“, „Migrationen“, „Tests“ ergänzen oder offene Punkte dort schließen.
