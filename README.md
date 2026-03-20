# Kassensystem

Offline-fähiges Kassensystem mit mehreren Kassenplätzen (Master/Slave), Händlerabrechnung, Abrechnungsläufen und P2P-Sync.

## Disclaimer (KI-unterstützte Entwicklung)

Teile dieses Quellcodes wurden mit Hilfe von **KI-gestützten Programmierwerkzeugen** (z. B. Code-Assistenten, automatische Vorschläge, Refactorings) erstellt, überarbeitet oder ergänzt. Es gibt **keine Garantie** für Vollständigkeit, Fehlerfreiheit, Sicherheit oder Eignung für einen bestimmten Zweck – insbesondere nicht für den Einsatz in regulierten oder sicherheitskritischen Umgebungen ohne eigene Prüfung. **Verantwortung für Prüfung, Betrieb und Compliance** liegt bei den Nutzerinnen und Nutzern bzw. den Betreibenden des Systems.

## Lizenz

Dieses Projekt steht unter der **MIT License** – siehe Datei [`LICENSE`](LICENSE). Die MIT-Lizenz ist permissiv: Nutzung, Änderung und Weitergabe sind mit wenigen Bedingungen möglich (u. a. Kopie des Lizenztextes beibehalten).

## Voraussetzungen

- **Node.js** (z. B. 20.x)
- **Rust** (für Tauri): [rustup](https://rustup.rs/)
- **npm**

## Überblick

- **Kasse**: Kundenabrechnung mit 1–n Positionen, automatische Belegnummern (`Prefix-Jahr-NNN`), Besetzung (Person 1/2).
- **Abrechnung**: Backend-Aggregat „Summe/Anzahl pro Händler“ + pro Händler **1-seitige A4-PDF**.
- **Handbuch**: In-App-Handbuch aus Markdown (pro Release gebundelt) + PDF-Export (Kapitel oder gesamtes Handbuch).
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

### Release-Builds in GitHub Actions (Linux / Windows / macOS)

Workflow [`.github/workflows/release-desktop.yml`](.github/workflows/release-desktop.yml) läuft bei **Tags** der Form `v*.*.*` (z. B. `v0.2.0`) oder **manuell** („Run workflow“). Zuerst werden dieselben Checks wie in der CI ausgeführt (`cargo test --features test`, `npm run lint`, `npm run test:run`); **erst danach** baut Tauri auf `ubuntu-latest`, `windows-latest` und `macos-latest`. Die Installationsartefakte liegen unter **Actions → Workflow run → Artifacts** (`src-tauri/target/release/bundle/` pro Runner).

**Version vor dem Tag** an drei Stellen angleichen: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` (Feld `[package] version` in `Cargo.toml`).

**Git (kurz):** Änderungen auf `main` mergen → Versionen bumpen → Tag setzen und pushen, z. B. `git tag v0.2.0 && git push origin v0.2.0`.

## Tests

Vor jedem Commit müssen alle Tests grün sein:

```bash
npm run test:all
```

In der CI laufen zusätzlich Lint (`npm run lint`) und optional der Tauri-Build.

### Rust-Tests in Linux-Docker (Mac/Windows vergleichbar)

Für reproduzierbare Rust-/Integrationstest-Ergebnisse auf macOS und Windows kann dieselbe Linux-Umgebung wie in CI genutzt werden:

```bash
npm run test:rust:docker
```

Nur die Ring-Tests:

```bash
npm run test:rust:docker -- --test sync_ring_n3
```

Der Script-Aufruf baut `docker/rust-tests/Dockerfile` und startet dann `scripts/docker-rust-test-inner.sh` (Xvfb + `cargo test --features test`) in `src-tauri` innerhalb des Containers (virtuelles X11 für GTK/Tao in headless Docker).
Das Docker-Image enthält die Linux-Build-Abhängigkeiten für Tauri/GTK (u. a. `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`), damit Rust-Tests im Container nicht an fehlenden `gdk-3.0`/WebKit-Paketen scheitern.
Zusätzlich nutzt das Image den **mold**-Linker und setzt `CARGO_BUILD_JOBS=1`, um RAM-Spitzen beim Linken zu reduzieren.

**Speicher:** Wenn der Build mit `ld terminated with signal 9 [Killed]` oder `collect2: ... signal 9` abbricht, hat der Linker meist ein **RAM-Limit** erreicht (typisch bei Docker Desktop). In den Docker-Einstellungen **Memory** erhöhen (z. B. **8 GB oder mehr**) und den Lauf wiederholen.

Optional mehr parallele Jobs (nur wenn genug RAM): `KASSEN_DOCKER_CARGO_JOBS=2 npm run test:rust:docker`.

Falls Ring-Tests mit Tao/EventLoop-Fehlern scheitern, einmal mit **einem** Test-Thread ausführen:  
`npm run test:rust:docker -- --test sync_ring_n3 -- --test-threads=1`

Windows-Hinweis: Das npm-Skript nutzt `bash`; falls lokal kein Bash verfügbar ist, den Docker-Befehl direkt ausführen:

```bash
docker build -f docker/rust-tests/Dockerfile -t kassensystem-rust-tests .
docker run --rm -t -v "${PWD}:/workspace" -w /workspace/src-tauri kassensystem-rust-tests bash /workspace/scripts/docker-rust-test-inner.sh 1 --test sync_ring_n3
```

## Hinweise

- DB: SQLite im App-Datenverzeichnis; Migrationen unter `src-tauri/migrations/`.
- Sync/Backend: Rust Commands unter `src-tauri/src/commands.rs`, Sync-Protokoll unter `src-tauri/src/sync/`.
- Handbuch: Markdown unter `docs/handbuch/de/` und `docs/handbuch/en/` (TOC aus Frontmatter: `title`, `order`, `slug`), gebündelt über `src/handbook/handbookIndex.ts`, Anzeige in `src/components/HandbookView.tsx`.
