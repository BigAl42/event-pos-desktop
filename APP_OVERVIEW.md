# Kassensystem – App-Übersicht (kurz & aktuell halten)

## Ziel / Scope
- **Ziel**: Offline-fähiges Kassensystem mit mehreren Kassenplätzen, Händlerabrechnung, später P2P-Sync.
- **Aktueller Stand**: Lokale Kasse **+ Master/Slave-Setup mit Sync**, Abrechnungsläufe, Storno und PDF-Export.

## Kern-Workflows
- **Erststart**: „Als Master einrichten?“ oder „Netz beitreten“; Kassenname + 2 Personen erfassen.
- **Startseite**: Tiles für **Kasse**, **Abrechnung**, **Handbuch**, **Einstellungen**; Sync-/Verbindungsstatus in der **Statuszeile (Footer)**.
  - **Nebenkasse**: Join-/Verbinden-UI nur bei fehlender Verbindung/Sync-Fehler + sichtbare **Closeout/Abmelden**-Kachel (führt zu Einstellungen).
- **Handbuch**: Markdown-Inhalte aus `docs/handbuch/` (pro Release gebundelt); TOC aus Frontmatter (`title`, `order`, `slug`). Eigene View mit TOC links, Inhalt rechts (react-markdown + remark-gfm). Einstiege: Startseite-Tile, Einstellungen-Header, Statuszeile „Hilfe“. **PDF-Export**: aktuelles Kapitel oder ganzes Handbuch via html2pdf.js + Save-Dialog + Tauri FS.
- **Kasse**:
  - Kundenabrechnung mit 1–n Positionen: Händlernummer, Betrag, optional Bezeichnung.
  - Besetzung (Person 1/2) anzeigen/ändern.
  - Belegnummer automatisch (Format `Prefix-Jahr-NNN`).
- **Abrechnung**:
  - Summen pro Händlernummer (Backend-Aggregat).
  - Pro Händler: **1-seitige A4-PDF-Abrechnung** (Stammdaten inkl. Adresse + eMail, Abrechnungslauf-Daten + Gesamtsumme groß; keine Einzelbuchungen).
  - **Hauptkasse**: **„Abrechnungslauf abschließen“** (Wizard): Closeout prüfen (optional „Trotzdem abschließen“ mit Peer-Ignore) → Exporte (PDF-Batch + Notfall-Export) → Export-Zusammenfassung in Step 3 → neuen Lauf starten (`create_abrechnungslauf`, optional `ignore_peers`).
- **Einstellungen**: in klaren, einklappbaren Bereichen (Akkordeon) organisiert; Anzeige dieser Kasse und Rolle.
  - **Nebenkasse**: Join (per URL/mDNS + Join-Code), Sync starten, **Closeout/Abmelden (Lauf fertig)** anfragen, optional **entkoppeln**.
  - **Hauptkasse**: WebSocket-Server starten, Join-Requests approve/reject, Sync starten, Abrechnungsläufe starten/löschen.
  - **Notfallmodus**: Bewegungsdaten eines Abrechnungslaufs als **Excel/CSV exportieren** und auf einer anderen Kasse **importieren** (Merge in aktiven Lauf; Warnung bei Lauf-ID-Abweichung, Import trotzdem möglich).

## Rollen / Multi-Instanz (Master/Slave)
- **Zwei lokale Kassen**: `npm run tauri:master` und `npm run tauri:slave`.
- **Trennung der Daten**: `KASSEN_INSTANCE=master|slave` → getrennte SQLite-DBs.
- **Slave**: eigener Vite-Port (1421) + eigene Tauri-Config (`tauri.slave.json`) für Parallelbetrieb.
- **Netz-Übersicht**: `Sync-Status` zeigt Sync-Peers inkl. Adresse (`ws_url`) und mDNS-Discovery gefundener Hauptkassen (Name+Adresse).
- **Laufende Synchronisation**: WebSocket-Sync tauscht **Kundenabrechnungen (sequenzbasiert)** und **Stornos** aus; Watermarks für Stornos werden per Ack bestätigt.
- **Abmelden (Closeout)**: Nebenkasse kann den Master bestätigen lassen, dass **alle Daten dieser Kasse angekommen sind** (Buchungen + Stornos), bevor sie sich abmeldet/entkoppelt; Master nutzt Closeout als Gate beim Abschluss.
- **Entkoppeln**: Beim „Abmelden & entkoppeln“ informiert die Nebenkasse die Hauptkasse, damit sie aus der Peer-Liste verschwindet (ws_url wird auf der Hauptkasse entfernt).
- **Abrechnungslauf-Wechsel**: Auf der Hauptkasse ist `create_abrechnungslauf` **geblockt**, solange verbundene Peers noch nicht vollständig übernommen sind; Admin kann „Trotzdem abschließen (Peers ignorieren)“ mit Bestätigung nutzen (`ignore_peers`).

## Architektur – High Level
- **Frontend**: Vite + React + TypeScript.
- **Backend**: Tauri (Rust) + SQLite.
- **Datenbank**: SQLite im App-Datenverzeichnis; Migration: `src-tauri/migrations/001_initial.sql`.
- **Backend-API**: Tauri-Commands (u.a. in `src-tauri/src/commands.rs`), Aufruf via `invoke` (z.B. `db.ts`).
- **PDF-Abrechnung**: Daten aus `get_haendler_abrechnung_pdf_data`, Rendering als druckoptimiertes HTML (`src/components/HaendlerAbrechnungPdf.tsx`), Export via `src/utils/pdfExport.ts` (html2canvas + jsPDF).
- **Handbuch**: `src/handbuch/handbuchIndex.ts` (Vite glob `docs/handbuch/**/*.md`, Frontmatter-Parse); `HandbuchView.tsx` + `src/utils/handbuchPdfExport.ts` (html2pdf.js für Multi-Page).
- **Sync-Protokoll**: `src-tauri/src/sync/*` (WebSocket, `Message`-enum in `src-tauri/src/sync/protocol.rs`).

## Wichtige Regeln/Leitplanken (aus Cursor-Rules)
- **Read-only Nebenkasse**: Read-only-Views (Nebenkasse/Slave) dürfen keine Mutationen (kein CRUD/Import/Sync).
- **Aggregationen ins Backend**: Umsätze/Summen/Statistiken ausschließlich im Backend berechnen und als Command bereitstellen.
- **Drilldowns**:
  - Listenzeilen nicht „unsichtbar“ klickbar; explizites Element (Details/Lupe).
  - Drilldown als eigene View im globalen View-State mit sichtbarem Zurück-Button in den fachlich passenden Kontext.

## Tests & Qualität
- **Vor jedem Commit**: `npm run test:all` (Frontend: Vitest, Backend: `cargo test --features test` in `src-tauri/`).
- **Husky**: `.husky/pre-commit` führt `npm run test:all` aus (Commit wird bei Fehlschlag abgebrochen).

## Build / Dev (Kurzreferenz)
- **Dev**: `npm install` → `npm run tauri dev`
- **Build**: `npm run build` → `npm run tauri build`

## Offene Roadmap (kurz)
- **Historie**: Abrechnungsläufe behalten/auswerten (statt Bewegungsdaten zu löschen) – falls gewünscht.

