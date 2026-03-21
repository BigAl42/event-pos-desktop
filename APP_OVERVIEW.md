# Kassensystem – App-Übersicht (kurz & aktuell halten)

## Ziel / Scope
- **Ziel**: Offline-fähiges Kassensystem mit mehreren Kassenplätzen, Händlerabrechnung, später P2P-Sync.
- **Aktueller Stand**: Lokale Kasse **+ Master/Slave-Setup mit Sync**, Abrechnungsläufe, Storno und PDF-Export.
- **Version**: `0.1.1` (synchron mit `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`).

## Internationalisierung (i18n)
- **Stack**: `i18next` + `react-i18next` + Browser-Detector; **Standard-Locale EN**, **DE** wählbar (Einstellungen → Sprache; Persistenz `localStorage` / `i18nextLng`).
- **Übersetzungen**: `src/locales/en.json`, `src/locales/de.json` (u.a. `errors.*` / `success.*` passend zu Rust-`UserMsg`-Codes, plus UI-Gruppen wie `home.*`, `cashRegister.*`, `statusBar.*`, `syncStatus.*`, `settings.language.*`).
- **Invoke-Fehler**: `src/tauriInvoke.ts` wrappt Tauri-`invoke`; nutzerrelevante Rust-Fehler als JSON `{ code, params }` → `src/userMessage.ts` → `t("errors…")`.
- **Intl**: `intlLocaleFor()` in `src/i18n.ts` (z.B. `en-GB` / `de-DE`) für Datums-/Zahlenformatierung, wo angebunden.
- **UI-Extraktion**: Kernflüsse **HomePage**, **CashRegisterView**, **StatusBar**, **SyncStatusContext**-Texte sind über `t()` lokalisiert; größere Views (**SettlementView**, **SettingsView** Akkordeon-Texte, **VoidView**, Join/Merchant-Hilfen, PDF-Beschriftungen) können noch feste deutsche Strings enthalten – bei Änderungen nach und nach auf `t()`-Keys migrieren.

## Kern-Workflows
- **Erststart**: „Als Master einrichten?“ oder „Netz beitreten“; Kassenname + 2 Personen erfassen.
- **Start** (`view === "start"`): **HomePage** – Tiles u.a. Kasse, Abrechnung, Handbuch, Einstellungen; Sync-Status in **StatusBar** (Footer).
  - **Nebenkasse**: Join-/Verbinden-UI nur bei fehlender Verbindung/Sync-Fehler + **Closeout**-Hinweis (Einstellungen).
- **Handbuch**: Markdown unter **`docs/handbuch/de/`** und **`docs/handbuch/en/`** (pro Release gebundelt); TOC aus Frontmatter (`title`, `order`, `slug`). Loader: `src/handbook/handbookIndex.ts` (Sprache aus `i18n.language`). View: **`HandbookView`** (lazy). Einstiege: Home-Tile, Einstellungen, StatusBar „Help“. **PDF-Export**: Kapitel/Gesamt via html2canvas + jsPDF + Tauri FS (`handbookPdfExport.ts`). **Screenshots**: `docs/handbuch/{de,en}/assets/*.png`; vor Dev/Build kopiert `scripts/sync-handbook-assets.mjs` → `public/handbuch/`; Neuaufnahme: `npm run handbook:screenshots` (Selenium + `tauri-driver`, Linux/Windows; macOS Desktop nicht unterstützt) oder GitHub Actions **Handbook screenshots** (`workflow_dispatch`, committet PNGs bzw. Artefakt). **Platzhalter neu zeichnen:** `npm run handbook:placeholders` (SVG→PNG via `sharp`, lesbarer Text auf dunklem Grund).
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
- **Netz-Übersicht**: `Sync-Status` zeigt Sync-Peers inkl. Adresse (`ws_url`), **TLS/WSS-Vertraulichkeitszeile**, **Zertifikats-Pin** (`kassen_cert_pins`) pro Peer sowie **Fingerprint der eigenen Kasse** (Runtime); mDNS-Hinweis, dass der Peer-Fingerprint erst nach Beitritt in der Peer-Liste erscheint.
- **Laufende Synchronisation**: WebSocket-Sync tauscht **Kundenabrechnungen (sequenzbasiert)** und **Stornos** aus; Watermarks für Stornos werden per Ack bestätigt.
- **Abmelden (Closeout)**: Nebenkasse kann den Master bestätigen lassen, dass **alle Daten dieser Kasse angekommen sind** (Buchungen + Stornos), bevor sie sich abmeldet/entkoppelt; Master nutzt Closeout als Gate beim Abschluss.
- **Entkoppeln**: Beim „Abmelden & entkoppeln“ informiert die Nebenkasse die Hauptkasse, damit sie aus der Peer-Liste verschwindet (ws_url wird auf der Hauptkasse entfernt).
- **Abrechnungslauf-Wechsel**: Auf der Hauptkasse ist `create_abrechnungslauf` **geblockt**, solange verbundene Peers noch nicht vollständig übernommen sind; Admin kann „Trotzdem abschließen (Peers ignorieren)“ mit Bestätigung nutzen (`ignore_peers`).

## Architektur – High Level
- **Frontend**: Vite + React + TypeScript.
- **Backend**: Tauri (Rust) + SQLite.
- **Datenbank**: SQLite im App-Datenverzeichnis; Migration: `src-tauri/migrations/001_initial.sql`.
- **Backend-API**: Tauri-Commands (u.a. in `src-tauri/src/commands.rs`); Frontend nutzt `invoke` über **`src/tauriInvoke.ts`** + `db.ts` für typisierte Aufrufe.
- **PDF-Abrechnung**: Daten aus `get_haendler_abrechnung_pdf_data`, Rendering als druckoptimiertes HTML (`src/components/MerchantSettlementPdf.tsx`), Export via `src/utils/pdfExport.ts` (html2canvas + jsPDF).
- **Handbuch**: `src/handbook/handbookIndex.ts` (Glob je Sprache unter `docs/handbuch/{de,en}/**/*.md`); `HandbookView.tsx` + `src/utils/handbookPdfExport.ts` (html2canvas + jsPDF für Multi-Page). Bilder im Markdown: `./handbuch/{de|en}/assets/…` (Quelle `docs/…`, Sync nach `public/`).
- **Sync-Protokoll**: `src-tauri/src/sync/*` (WebSocket, `Message`-enum in `src-tauri/src/sync/protocol.rs`).

## Frontend: Views (Auswahl, englische `view`-Keys in `App.tsx`)
- u.a. `start`, `cash_register`, `settlement`, `void`, `sync_status`, `settings`, `handbook`, `merchant_admin`, `merchant_slave`, `merchant_drilldown`, `merchant_master_overview`, `merchant_master_drilldown`, `merchant_master_data`, `join_requests`.

## Wichtige Regeln/Leitplanken (aus Cursor-Rules)
- **Read-only Nebenkasse**: Read-only-Views (Nebenkasse/Slave) dürfen keine Mutationen (kein CRUD/Import/Sync); Komponente **`SlaveMerchantOverview`**.
- **Aggregationen ins Backend**: Umsätze/Summen/Statistiken ausschließlich im Backend berechnen und als Command bereitstellen.
- **Drilldowns**:
  - Listenzeilen nicht „unsichtbar“ klickbar; explizites Element (Details/Lupe).
  - Drilldown als eigene View im globalen View-State (z.B. `merchant_drilldown`) mit sichtbarem Zurück-Button in den fachlich passenden Kontext.

## Tests & Qualität
- **Vor jedem Commit**: `npm run test:all`, `npm run build`; zusätzlich einmal `npx tauri build` (vollständiger App-Build), Fehler beheben. Details: `.cursor/rules/tests-vor-commit.mdc`.
- **Husky**: `.husky/pre-commit` führt `npm run test:all` und `npm run build` aus (Commit wird bei Fehlschlag abgebrochen).
- **N=3 Ring-Sync (Rust)**: `src-tauri/tests/sync_ring_n3.rs` – **ein** libtest-Eintrag führt beide Szenarien nacheinander aus (kein paralleler GTK-Start); auf **macOS** per `ignore` übersprungen (`0 passed; 1 ignored` ist erwartet); Ausführung auf **Linux/Windows** oder CI (`cargo test --features test --test sync_ring_n3` in `src-tauri/`).
- **Linux-Docker für Rust-Tests**: `npm run test:rust:docker` nutzt `docker/rust-tests/Dockerfile` und `scripts/docker-rust-test-inner.sh` (Xvfb + `cargo test --features test` in `src-tauri/`); damit sind Ergebnisse auf macOS/Windows mit CI-Linux besser vergleichbar. Image: GTK/WebKit-Dev-Pakete, **mold**-Linker, `-j 1` gegen RAM-Spitzen; bei `signal 9 [Killed]` beim Linken Docker-RAM erhöhen (z. B. 8 GB+).

## Build / Dev (Kurzreferenz)
- **Dev**: `npm install` → `npm run tauri dev`
- **Build**: `npm run build` → `npm run tauri build`
- **Release-CI**: `.github/workflows/release-desktop.yml` – nach grünen Tests (Rust + Lint + Vitest) Bundles für Linux/Windows/macOS; Trigger: Tag `v*.*.*` oder `workflow_dispatch`; Artefakte: `bundle/` je Runner. Rust-Toolchain: `rust-toolchain.toml` (stable).

## Offene Roadmap (kurz)
- **Historie**: Abrechnungsläufe behalten/auswerten (statt Bewegungsdaten zu löschen) – falls gewünscht.

