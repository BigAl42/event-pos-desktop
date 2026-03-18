# Kassensystem

Offline-fähiges Kassensystem mit mehreren Kassenplätzen (Master/Slave), Händlerabrechnung, Abrechnungsläufen und P2P-Sync.

## Voraussetzungen

- **Node.js** (z. B. 20.x)
- **Rust** (für Tauri): [rustup](https://rustup.rs/)
- **npm**

## Überblick

- **Kasse**: Kundenabrechnung mit 1–n Positionen, automatische Belegnummern (`Prefix-Jahr-NNN`), Besetzung (Person 1/2).
- **Abrechnung**: Backend-Aggregat „Summe/Anzahl pro Händler“ + pro Händler **1-seitige A4-PDF**.
- **Abrechnungsläufe**: aktiver Lauf steuert den „Kassentag“ (Buchungen/Kundenabrechnungen hängen an `abrechnungslauf_id`).
- **Sync (Master/Slave)**: WebSocket-Sync für Kundenabrechnungen (sequenzbasiert) + Stornos.
- **Closeout (Slave)**: Nebenkasse kann bestätigen lassen, dass beim Master alle Daten angekommen sind.
- **Abschluss (Master)**: geführter Wizard „Abrechnungslauf abschließen“: Closeout-Gate → Exporte (PDF-Batch + Notfall-Export) → neuen Lauf starten.

Mehr Details (kurz & aktuell): `APP_OVERVIEW.md`.

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
Beim Erststart: „Als Master-Kasse“ einrichten. In **Einstellungen**: Server starten, Join-Token generieren, danach „Sync zu Peers starten“.

**Terminal 2 – Slave:**
```bash
npm run tauri:slave
```
Beim Erststart: „Netz beitreten“ wählen. In **Einstellungen**: Master-URL (z. B. `ws://127.0.0.1:8765`), eigene Sync-URL (z. B. `ws://127.0.0.1:8766`), Join-Code eintragen, „Netz beitreten“ – danach startet der Sync automatisch.

Die Umgebungsvariable `KASSEN_INSTANCE` (master/slave) sorgt für getrennte SQLite-Datenbanken; die Slave-Instanz nutzt zudem Vite-Port 1421 und eine eigene Tauri-Config (`tauri.slave.json`), damit beide parallel laufen können.

### Abmelden / Closeout (Slave)

- In **Einstellungen → Netzwerk (Nebenkasse)**: „Closeout bei Hauptkasse anfragen“.
- Optional danach: „Abmelden & entkoppeln“ (nur nach erfolgreichem Closeout).

### Abrechnungslauf abschließen (Master)

In **Abrechnung** gibt es den Button „Abrechnungslauf abschließen“ (Wizard):

1) Closeout aller relevanten Slaves prüfen (Gate)  
2) Exporte speichern (PDF-Batch + Notfall-Export)  
3) Neuen Lauf starten (löscht Bewegungsdaten des alten Laufs)

## Build

```bash
npm run build
npm run tauri build
```

## Tests

Vor jedem Commit müssen alle Tests grün sein:

```bash
npm run test:all
```

In der CI laufen zusätzlich Lint (`npm run lint`) und optional der Tauri-Build.

## Hinweise

- DB: SQLite im App-Datenverzeichnis; Migrationen unter `src-tauri/migrations/`.
- Sync/Backend: Rust Commands unter `src-tauri/src/commands.rs`, Sync-Protokoll unter `src-tauri/src/sync/`.
