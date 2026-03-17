---
name: drilldown-lupe-neues-fenster
overview: "Passt den Händler-Drilldown auf Slave-Kassen an: statt Overlay unterhalb des Menüs wird er über eine Lupe-Schaltfläche aus der Händlerliste geöffnet und vorzugsweise in einem eigenen Fenster angezeigt."
todos:
  - id: update-haendler-slave-lupe
    content: In HaendlerSlaveView Zeilenklick entfernen und eine Lupe-Schaltfläche pro Händlerzeile hinzufügen, die den Drilldown auslöst
    status: completed
  - id: remove-app-overlay-drilldown
    content: Overlay-Rendering von HaendlerBuchungenDrilldown aus App entfernen, damit kein Drilldown mehr unterhalb des Menüs erscheint
    status: completed
  - id: implement-drilldown-window-or-view
    content: Beim Klick auf die Lupe ein separates Drilldown-Fenster oder eine eigenständige Vollbild-Drilldown-View öffnen
    status: completed
  - id: adapt-drilldown-component
    content: HaendlerBuchungenDrilldown so anpassen, dass sie im neuen Kontext (Fenster oder Vollbild-View) sauber funktioniert
    status: completed
  - id: test-drilldown-ux-slave
    content: Auf einer Slave-Kasse die neue Drilldown-Interaktion (Lupe, Fenster/Ansicht, Schließen) vollständig durchtesten
    status: completed
isProject: false
---

### Ziel

Der Drilldown für Händlerbuchungen auf den Slave-Kassen soll **nicht mehr als Overlay/Ansicht innerhalb des Hauptfensters** erscheinen. Stattdessen soll in der **Händlerübersicht** eine **kleine Lupe-Schaltfläche pro Zeile** angezeigt werden. Beim Klick auf diese Lupe öffnet sich **eine separate Drilldown-Ansicht**, vorzugsweise in einem **eigenen Tauri-Fenster**, das die gruppierten Buchungen zur gewählten Händlernnummer anzeigt.

### Relevante bestehende Stellen

- **Slave-Händlerübersicht**
  - `[src/components/HaendlerSlaveView.tsx](src/components/HaendlerSlaveView.tsx)`
    - Read-only Händlerliste für Slaves (Nummer, Name, Sortierung, Umsatz-Spalte).
    - Aktuell: Klick auf die gesamte Zeile ruft ein Callback `onOpenDrilldown(haendlernummer, name)` auf.
- **Drilldown-Ansicht**
  - `[src/components/HaendlerBuchungenDrilldown.tsx](src/components/HaendlerBuchungenDrilldown.tsx)`
    - Zeigt Buchungen eines Händlers, gruppiert nach Kasse (`kassen_name`/`kassen_id`), inkl. Export (CSV) und Drucken.
    - Wird aktuell als **Overlay-Komponente** innerhalb von `App` gerendert.
- **App-Shell & Routing**
  - `[src/App.tsx](src/App.tsx)`
    - Steuert Views (`view`-State inkl. `"haendler_slave"`).
    - Hält den State `drilldownHaendler` und rendert daraufhin `HaendlerBuchungenDrilldown` als Overlay über der `app-main`-Ansicht.

### Geplante Änderungen

1. **Interaktion in der Slave-Händlerliste anpassen (Lupe-Button)**
  - In `[src/components/HaendlerSlaveView.tsx](src/components/HaendlerSlaveView.tsx)`:
    - Statt die **gesamte Listenzeile klickbar** zu machen (`onClick` auf `<li>`), wird eine **separate Schaltfläche mit Lupe-Icon/Text** ergänzt, z.B. ein Button am rechten Rand der Zeile.
    - Klick auf diese Lupe ruft weiterhin ein zentrales Callback auf (z.B. `onOpenDrilldown(haendlernummer, name)`), die Zeile selbst bleibt nicht klickbar.
    - Dadurch ist klar erkennbar, dass es sich um einen **Detail-Drilldown** handelt und nicht um eine Navigation innerhalb des Hauptmenüs.
2. **Overlay-Drilldown aus der Haupt-App entfernen**
  - In `[src/App.tsx](src/App.tsx)`:
    - Den State `drilldownHaendler` und das Rendern von `HaendlerBuchungenDrilldown` als Overlay-Komponente innerhalb der Haupt-Layoutstruktur entfernen.
    - `App` bleibt zuständig für Haupt-Views (Startseite, Kasse, Abrechnung, Storno, Händlerverwaltung, Slave-Händlerübersicht), aber **nicht mehr für den Händler-Drilldown**.
3. **Neues Tauri-Fenster für Drilldown einführen**
  - Variante A (bevorzugt): **Eigenes Tauri-Webview-Fenster** nutzen.
    - Im Frontend (z.B. in `[src/components/HaendlerSlaveView.tsx](src/components/HaendlerSlaveView.tsx)`) das `@tauri-apps/api/window`-Modul verwenden (`WebviewWindow`), um beim Klick auf die Lupe ein neues Fenster zu öffnen.
    - Das neue Fenster erhält eine eindeutige `label`-ID (z.B. `"haendler-drilldown-${haendlernummer}"`) und eine URL, die die benötigten Informationen enthält (z.B. Query-Parameter oder Hash mit Händlernnummer und Name).
    - In der Tauri-Konfiguration (`[src-tauri/tauri.conf.json](src-tauri/tauri.conf.json)`) sicherstellen, dass dynamisch erzeugte Windows/URLs durch das Bundle geladen werden dürfen (ggf. `window`-Einstellungen und Sicherheits-URLs prüfen/erweitern).
  - Variante B (Fallback): **Eigenes React-View innerhalb desselben Fensters**, aber in separater Vollbild-Ansicht.
    - Anstatt ein neues OS-Fenster zu erstellen, wird in `App` ein weiterer View-Typ eingeführt (z.B. `"haendler_drilldown"`), der ausschließlich `HaendlerBuchungenDrilldown` rendert.
    - Navigation von `HaendlerSlaveView` zu diesem View mit Übergabe der Händlerdaten (z.B. via globalem State oder Kontext).
    - Visuell dennoch als modaler Bildschirm ohne Menüzeile gestaltet, sodass er **nicht „unterhalb des Menüs“** erscheint, sondern als eigener Vollbild-Dialog.
  - Der Implementierungsschritt wählt **eine der beiden Varianten** (bevorzugt A, sofern Tauri-Konfiguration dies einfach zulässt); die andere dient als klare Alternative, falls technisch sinnvoller.
4. **Drilldown-Komponente für Fensterbetrieb vorbereiten**
  - `[src/components/HaendlerBuchungenDrilldown.tsx](src/components/HaendlerBuchungenDrilldown.tsx)` so anpassen, dass sie sich **unabhängig** vom App-Layout korrekt darstellen lässt:
    - Sicherstellen, dass sie ohne `abrechnung-overlay`-Umgebung (oder mit leichter Anpassung) auch in einem eigenständigen Fenster nutzbar ist.
    - Den `onClose`-Handler so nutzen, dass im Fenster-Kontext einfach `window.close()` (oder `appWindow.close()`) aufgerufen werden kann.
    - Bei Variante B (neuer View in `App`) bleibt `onClose` als Callback zur Rückkehr in die Slave-Händlerübersicht (`setView("haendler_slave")`).
5. **UX-Feinschliff**
  - Lupe-Schaltfläche in der Händlerliste klar und kompakt halten (Icon oder kurzer Text wie „Details“).
  - Titel des Drilldown-Fensters setzen, z.B. „Buchungen – Händler 123 – Max Mustermann“.
  - Sicherstellen, dass beim Schließen des Drilldown-Fensters (X, Alt+F4 etc.) keine ungültigen App-Zustände verbleiben.

### Umsetzungsschritte (kurz)

1. **HaendlerSlaveView**: Zeilenklick entfernen, Lupe-Button hinzufügen, Callback unverändert beibehalten.
2. **App**: State/Overlay-Rendering von `HaendlerBuchungenDrilldown` entfernen.
3. **Fensterlogik**: Bei Klick auf Lupe neues Fenster öffnen (Variante A mit `WebviewWindow`) oder auf neuen App-View navigieren (Variante B).
4. **Drilldown-Komponente**: Für eigenständigen Betrieb im neuen Kontext (Fenster oder Vollbild-View) justieren.
5. **Tests**: Auf einer Slave-Kasse prüfen, dass
  - die Händlerliste unverändert read-only bleibt,
  - die Lupe erscheint,
  - der Drilldown nur über die Lupe geöffnet wird,
  - der Drilldown nicht mehr als Element „unterhalb des Menüs“ im Hauptfenster angezeigt wird.

