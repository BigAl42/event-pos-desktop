# Kassensystem

Offline-fähiges Kassensystem mit mehreren Kassenplätzen, Händlerabrechnung und P2P-Sync (Phase 1: lokale Kasse ohne Sync).

## Voraussetzungen

- **Node.js** (z. B. 20.x)
- **Rust** (für Tauri): [rustup](https://rustup.rs/)
- **npm**

## Entwicklung

```bash
npm install
npm run tauri dev
```

Öffnet die App mit Vite-Dev-Server und Hot-Reload.

### Zwei Kassen lokal starten (zum Testen von Master/Slave und Sync)

Zwei getrennte Fenster mit eigenem Datenverzeichnis:

**Terminal 1 – Master:**
```bash
npm run tauri:master
```
Beim Erststart: „Als Master-Kasse“ einrichten. In Einstellungen: Server starten, Join-Token generieren, danach „Sync zu Peers starten“.

**Terminal 2 – Slave:**
```bash
npm run tauri:slave
```
Beim Erststart: „Netz beitreten“ wählen. In Einstellungen: Master-URL (z. B. `ws://127.0.0.1:8765`), eigene Sync-URL (z. B. `ws://127.0.0.1:8766`), Join-Token eintragen, „Netz beitreten“ – danach startet der Sync automatisch.

Die Umgebungsvariable `KASSEN_INSTANCE` (master/slave) sorgt für getrennte SQLite-Datenbanken; die Slave-Instanz nutzt zudem Vite-Port 1421 und eine eigene Tauri-Config (`tauri.slave.json`), damit beide parallel laufen können.

## Build

```bash
npm run build
npm run tauri build
```

## Phase 1 (aktuell)

- **Erststart**: Dialog „Als Master einrichten?“ oder „Netz beitreten“; Kassenname und zwei Personen erfassen.
- **Startseite**: Tiles für Kasse, Abrechnung, Einstellungen.
- **Kasse**: Kundenabrechnung mit 1–n Positionen (Händlernummer, Betrag, optional Bezeichnung); Besetzung (Person 1/2) anzeigen und ändern; Belegnummer automatisch (Format `Prefix-Jahr-NNN`).
- **Abrechnung**: Summen pro Händlernummer.
- **Einstellungen**: Anzeige dieser Kasse und Rolle.

Datenbank: SQLite im App-Datenverzeichnis; Migration in `src-tauri/migrations/001_initial.sql`.

## Nächste Schritte (Plan)

- Phase 2: Master WebSocket-Server, Join-Token, Händlerverwaltung, Join-Request/Approve.
- Phase 3: Sync-Protokoll (Kundenabrechnungen zwischen Kassen).
- Phase 4: Robustheit, Storno, UX.

Siehe `.cursor/plans/option_a_implementierungsplan_*.plan.md`.
