---
name: nebenskasse-haendlerliste-readonly
overview: Fügt auf Nebenkassen eine schreibgeschützte Händlerlisten-Übersicht hinzu, inklusive aktuellem Umsatz pro Händler (für den aktuell offenen Kassentag) und Drilldown auf alle Buchungen eines Händlers, gruppiert nach Kassen.
todos:
  - id: backend-commands-haendler-umsatz
    content: Neue/erweiterte Backend-Commands und SQL-Queries für Händlerumsätze und Buchungen im aktuellen Kassentag implementieren
    status: completed
  - id: db-wrapper-typen
    content: Neue Typen und Wrapper-Funktionen in db.ts für Händlerumsatz und Buchungs-Drilldown hinzufügen
    status: completed
  - id: ui-nebenskasse-haendlerliste
    content: Read-only Händlerlisten-Ansicht für Nebenkassen erstellen, inkl. Umsatz-Spalte und Drilldown-Trigger
    status: completed
  - id: ui-drilldown-buchungen
    content: Drilldown-Komponente für Buchungen pro Händler (inkl. Export und Drucken) implementieren
    status: completed
  - id: routing-rollensicht
    content: Routing und Startseiten-Kacheln für Slave-Händlerübersicht anpassen
    status: completed
  - id: tests-und-ux-feinschliff
    content: Rollenverhalten, Datenkorrektheit und UX der neuen Ansichten testen und optimieren
    status: completed
isProject: false
---

### Ziel

Auf allen Nebenkassen soll eine **Händlerlisten-Übersicht im Read-only-Modus** verfügbar sein. Sie verwendet weitgehend das Layout der bestehenden Händlerverwaltung, zeigt zusätzlich den **aktuellen Umsatz pro Händler für den aktuell offenen Kassentag** und bietet einen **Drilldown auf alle Buchungen eines Händlers im gleichen Zeitraum**, aufgeschlüsselt nach Kassen. Im Drilldown sind nur Anzeige, Export (CSV/PDF) und Drucken erlaubt, keine mutierenden Aktionen.

### Relevante bestehende Stellen

- **Rollen & Startseite**
  - `App` in `[src/App.tsx](src/App.tsx)` initialisiert `role` und die Views.
  - `Startseite` in `[src/components/Startseite.tsx](src/components/Startseite.tsx)` zeigt aktuell die Kachel „Händlerverwaltung“ nur für die Hauptkasse (`role === "master"`).
  - `Statuszeile` in `[src/components/Statuszeile.tsx](src/components/Statuszeile.tsx)` visualisiert Hauptkasse-/Nebenkassen-Status.
- **Händlerverwaltung & Händlerdaten**
  - `HaendlerverwaltungView` in `[src/components/HaendlerverwaltungView.tsx](src/components/HaendlerverwaltungView.tsx)` enthält Formular und Händlerliste (editierbar, mit Buttons „Bearbeiten“/„Löschen“).
  - Händler-Modelle und -Zugriffe in `[src/db.ts](src/db.ts)` (`HaendlerItem`, `getHaendlerList`, `createHaendler`, `updateHaendler`, `deleteHaendler`).
- **Umsatz-/Abrechnungslogik**
  - `getAbrechnung` in `[src/db.ts](src/db.ts)` aggregiert Umsätze pro `haendlernummer` über `buchungen` und liefert `AbrechnungZeile` (`haendlernummer`, `summe`, `anzahl`).
  - `AbrechnungView` in `[src/components/AbrechnungView.tsx](src/components/AbrechnungView.tsx)` zeigt die Tabelle „Abrechnung (Händler)“.
  - `get_recent_abrechnungen` und Listenmodelle (`KundenabrechnungListItem`, `BuchungListItem`) in `[src-tauri/src/commands.rs](src-tauri/src/commands.rs)` und `[src/db.ts](src/db.ts)` liefern Kassen- und Buchungsdaten mit Summen.

### Geplante Erweiterungen

1. **Neue read-only Händlerlisten-View für Nebenkassen**
  - In `[src/components/HaendlerverwaltungView.tsx](src/components/HaendlerverwaltungView.tsx)` oder als neue Komponente z.B. `[src/components/HaendlerSlaveView.tsx](src/components/HaendlerSlaveView.tsx)` eine **Händlerlisten-Ansicht ohne Formular und ohne Edit/Delete-Aktionen** aufbauen.
  - Layout an der bestehenden Händlerliste orientieren (Liste oder Tabelle mit `haendlernummer`, `name`, Sortierung), aber:
    - keine Buttons für Bearbeiten/Löschen,
    - keine Import/Export-Funktionen, die Stammdaten ändern würden,
    - ggf. nur reine Filter-/Suchfelder erlauben.
  - Die Komponente soll zusätzlich eine Spalte **„Umsatz aktuell“** enthalten.
2. **Umsatz pro Händler für den aktuell offenen Kassentag ermitteln**
  - Fachliche Annahme: „aktueller Kassentag“ entspricht dem Zeitraum, der auch für Abrechnungen/Reports verwendet wird (z.B. geöffneter Kassentag oder definierte Tagesgrenze). Wir nutzen denselben Zeitraum wie für die bestehende Abrechnungslogik.
  - Backend-Erweiterung in `[src-tauri/src/commands.rs](src-tauri/src/commands.rs)`:
    - Entweder bestehenden Befehl für `getAbrechnung` erweitern, sodass er optional einen **Zeitraum (aktueller Kassentag)** entgegennehmen kann,
    - oder einen neuen Befehl wie `get_haendler_umsatz_for_current_day` einführen, der eine Liste `AbrechnungZeile` (oder neuen Typ mit gleicher Struktur) für den aktuellen Tag zurückgibt.
  - In `[src/db.ts](src/db.ts)` einen passenden Wrapper z.B. `getHaendlerUmsatzForCurrentDay()` implementieren, der diese Daten holt und per `haendlernummer` mappbar für die Slave-Händlerliste macht.
3. **Drilldown auf Buchungen pro Händler, gruppiert nach Kassen**
  - Backend-Erweiterung in `[src-tauri/src/commands.rs](src-tauri/src/commands.rs)`:
    - Neuer Befehl, z.B. `get_buchungen_for_haendler_in_current_day`, der alle relevanten Buchungen eines Händlers im Zeitraum des aktuellen Kassentags liefert.
    - Rückgabe-Struktur enthält mindestens: `id`, `haendlernummer`, `betrag`, `bezeichnung`, `zeitstempel`, `kassen_id`, `kassen_name`, optional `ist_storniert`.
    - SQL ähnlich der bestehenden Aggregationen (`getAbrechnung`, `get_recent_abrechnungen`), aber mit Filter auf `haendlernummer` und Zeitraum.
  - In `[src/db.ts](src/db.ts)` dazu einen Typ `HaendlerBuchungItem` und einen Wrapper z.B. `getBuchungenForHaendlerCurrentDay(haendlernummer: number)` hinzufügen.
  - Neue Drilldown-Komponente, z.B. `[src/components/HaendlerBuchungenDrilldown.tsx](src/components/HaendlerBuchungenDrilldown.tsx)`:
    - Darstellung als Tabelle mit Gruppierung/Sortierung nach Kasse (`kassen_name`) und ggf. Zeit.
    - Öffnen als Dialog/Overlay aus der Slave-Händlerliste beim Klick auf eine Zeile („Details“ oder Klick auf ganze Zeile).
    - Nur Anzeige-Funktionen: kein Bearbeiten, kein Storno.
4. **Export- und Druckfunktionen im Drilldown (ohne Mutationen)**
  - In der Drilldown-Komponente Buttons vorsehen:
    - **„Export CSV“**: client-seitiger Export der aktuell gefilterten Drilldown-Daten in eine CSV-Datei.
    - **„Drucken“**: Druck-Ansicht (z.B. via neues Fenster/Print-Styles oder einfache Print-View-Komponente), die den aktuellen Drilldown-Inhalt darstellt.
  - Keine Änderungen an Backend-Logik nötig; Export/Druck bleiben rein lesend.
5. **Navigation & Rollenlogik anpassen**
  - In `App` (`[src/App.tsx](src/App.tsx)`) einen neuen `view`-Typ für die Nebenkassen-Händlerliste definieren (z.B. `"haendler_slave"`).
  - In `Startseite` (`[src/components/Startseite.tsx](src/components/Startseite.tsx)`) für `role === "slave"` eine neue Kachel hinzufügen, z.B. „Händlerübersicht“:
    - Klick setzt `view` auf `"haendler_slave"`.
  - Sicherstellen, dass die Händlerverwaltung der Hauptkasse (`"haendler"`-View) weiterhin nur für `role === "master"` sichtbar bleibt.
6. **Sicherheit / Read-only-Garantien**
  - Prüfen, dass in der neuen Nebenkassen-Händlerlisten-Komponente keinerlei Aufrufe von mutierenden Funktionen vorkommen:
    - Keine Nutzung von `createHaendler`, `updateHaendler`, `deleteHaendler`.
    - Kein Triggern von Import-/Sync-Funktionen, die Stammdaten verändern.
  - Optional (falls sinnvoll): zusätzliche Guards im Backend, sodass Händler-CRUD-Endpunkte weiterhin nur auf Hauptkassen-Seite write-fähig sind (dies ist bereits weitgehend so implementiert, sollte aber bei neuen Endpunkten geprüft werden).
7. **UX/Design-Feinschliff**
  - Beschriftungen und Hilfetexte anpassen, z.B. in der Nebenkassen-Händlerliste einen Hinweis anzeigen: „Diese Ansicht ist schreibgeschützt. Änderungen an Händlern sind nur an der Hauptkasse möglich.“
  - Spaltenreihenfolge und Formatierung des Umsatzwertes (Währung, Nachkommastellen) an die bestehende `AbrechnungView` anlehnen, damit es für Nutzer konsistent ist.

### Grober Ablauf der Umsetzung

1. **Backend-Erweiterungen**
  - Neue/erweiterte Commands in `commands.rs` für Umsatz pro Händler im aktuellen Kassentag und Buchungen pro Händler im aktuellen Kassentag.
  - Entsprechende SQL-Queries für Zeitfilter und Gruppierung/Kassenbezug definieren.
2. **DB-Wrapper & Typen**
  - Neue Typen und Wrapper-Funktionen in `db.ts` zum Holen der Händlerumsätze für den aktuellen Tag und der Buchungslisten pro Händler.
3. **UI-View für Slave-Händlerliste**
  - Neue read-only-Komponente für die Händlerliste erstellen (auf Basis von `HaendlerverwaltungView`), inklusive Umsatz-Spalte und Trigger für den Drilldown.
4. **Drilldown-Ansicht**
  - Drilldown-Komponente implementieren, die die Buchungen pro Händler zeigt und Export/Druck anbietet.
5. **Routen & Rollenlogik**
  - `App` und `Startseite` anpassen, damit Nebenkassen die neue Händlerübersicht erreichen, ohne die Hauptkassen-Verwaltung zu sehen.
6. **Tests & Feinschliff**
  - Manuell auf Hauptkasse und Nebenkassen prüfen, dass Rollen-Logik, Summen, Drilldown und Export/Druck wie gewünscht funktionieren.

