---
name: abrechnungsläufe_events
overview: Echte, benennbare Abrechnungsläufe (Events) einführen, die systemweit gelten, in den Einstellungen verwaltet werden und beim Start eines neuen Laufs wie bisher einen harten Reset der Bewegungsdaten auslösen, aber als Lauf mit Name/Datum historisiert werden.
todos:
  - id: db-migration-lauf
    content: Neue Tabelle `abrechnungslauf` + Spalte `abrechnungslauf_id` in `kundenabrechnung` mit Default-Lauf in Migration anlegen.
    status: completed
  - id: backend-commands-lauf
    content: Tauri-Commands für Abrechnungslauf-Management implementieren und bestehende Abrechnungs-/Drilldown-Commands auf `abrechnungslauf_id` umstellen.
    status: completed
  - id: frontend-db-lauf
    content: TypeScript-DB-Layer um `Abrechnungslauf`-Typ und zugehörige Funktionen erweitern.
    status: completed
  - id: settings-ui-lauf
    content: Einstellungs-UI für Abrechnungsläufe anlegen (Liste, neuer Lauf, Lauf löschen mit Bestätigungen).
    status: completed
  - id: ux-hinweis-aktueller-lauf
    content: Optionalen Hinweis auf den aktuellen Lauf in Abrechnung-/Händler-Views einbauen.
    status: completed
isProject: false
---

### Zielbild

Wir führen ein explizites Konzept von **Abrechnungsläufen** (Events) ein:

- Jeder Lauf hat **Name**, **Startzeitpunkt**, optional **Endzeitpunkt** und eine **laufende ID**.
- Es gibt **immer genau einen aktiven Lauf** für das gesamte System (alle Kassen gemeinsam).
- Beim Start eines neuen Laufs verhalten wir uns fachlich wie heute `reset_abrechnungslauf` (Bewegungsdaten = 0), aber wir **verlieren die Information über alte Läufe nicht**, sondern können sie im Backend/DB erkennen.
- In den **Einstellungen** gibt es einen Bereich „Abrechnungsläufe“, um Läufe anzulegen, den aktuellen zu sehen und alte Läufe zu verwalten (anzeigen, optional löschen).

### Technisches Datenmodell

- **Neue Tabelle `abrechnungslauf`** in einer Migration, z.B. in `src-tauri/migrations/00x_abrechnungslauf.sql`:
  - `id` (TEXT, UUID oder INTEGER AUTOINCREMENT)
  - `name` (TEXT, Pflicht)
  - `start_zeitpunkt` (TIMESTAMP, Pflicht)
  - `end_zeitpunkt` (TIMESTAMP NULL, Lauf ist offen, solange `NULL`)
  - `is_aktiv` (BOOLEAN, genau ein Datensatz ist `TRUE`)
- **Beziehung zu Bewegungsdaten**:
  - Bestehende Tabellen `kundenabrechnung` und `buchungen` bleiben unverändert.
  - Wir koppeln `kundenabrechnung` **logisch** an den aktiven Lauf, indem wir beim Erzeugen einer Kundenabrechnung die **aktuelle Lauf-ID** in einer zusätzlichen Spalte speichern:
    - Migration: Spalte `abrechnungslauf_id` in `kundenabrechnung` hinzufügen (FOREIGN KEY auf `abrechnungslauf(id)`).
  - Alle Aggregationen für Abrechnung, Händler-Umsätze, Drilldowns, Storno etc. werden zukünftig **immer per `abrechnungslauf_id` auf den aktiven Lauf gefiltert**.

### Backend-Anpassungen (Rust/Tauri)

- **Neue Helper-Funktion** in `src-tauri/src/commands.rs` oder `db.rs`:
  - `fn get_aktiver_abrechnungslauf_id(conn: &Connection) -> Result<String, String>`
  - Sucht den Datensatz mit `is_aktiv = 1`; wenn keiner existiert, legt sie optional einen Default-Lauf an (z.B. "Initialer Lauf") oder gibt einen klaren Fehler zurück.
- **Command: get_abrechnungsläufe**
  - Liefert Liste aller Läufe mit ID, Name, Start/Ende, `is_aktiv` an das Frontend.
- **Command: create_abrechnungslauf(name, start_zeitpunkt_opt)**
  - Setzt beim Aufruf **den bisherigen aktiven Lauf** auf `end_zeitpunkt = now()` und `is_aktiv = 0`.
  - Legt einen neuen Datensatz mit `name`, `start_zeitpunkt = now()` (oder explizitem Datum), `is_aktiv = 1` an.
  - Führt anschließend einen angepassten **Reset-Mechanismus** aus (siehe unten).
- **Command: delete_abrechnungslauf(id)**
  - Erlaubt das Löschen eines **nicht aktiven** Laufs, inkl. der dazugehörigen Bewegungsdaten:
    - Löscht `stornos`, `buchungen`, `kundenabrechnung` **für diesen Lauf** (JOIN/WHERE auf `abrechnungslauf_id`).
    - Entfernt den Lauf-Datensatz selbst.
  - Schutz: Aktiver Lauf darf nicht gelöscht werden.
- **Anpassung: create_kundenabrechnung** (Rust-Seite)
  - Beim Einfügen in `kundenabrechnung` zusätzlich `abrechnungslauf_id = get_aktiver_abrechnungslauf_id(...)` setzen.
- **Anpassung: get_haendler_umsatz, get_buchungen_for_haendler, get_recent_abrechnungen, get_buchungen_for_abrechnung**
  - Alle SELECTs erhalten einen zusätzlichen Filter `WHERE kundenabrechnung.abrechnungslauf_id = ?1`.
  - Standardmäßig wird im Command die ID des aktiven Laufs gezogen.
  - Optional: Erweiterung um einen Parameter `lauf_id`, um historische Läufe explizit abzufragen (für spätere Erweiterungen).
- **Neuer Reset-Mechanismus für neuen Lauf**
  - Die bisherige Funktion `reset_abrechnungslauf` bleibt aus Abwärtskompatibilität intern bestehen, wird aber nur noch **intern beim Anlegen eines neuen Laufs** aufgerufen.
  - Anpassung: Statt **global** alles zu löschen, wird zukünftig wie folgt vorgegangen:
    - Für den neuen Lauf werden keine alten Daten mehr benötigt; wir können zwei Strategien planen und im Code klar wählen (Plan-Entscheidung, siehe unten):
      - **Variante A (sicher, mehr Speicher)**: Alte Bewegungsdaten bleiben im DB bestehen (über `abrechnungslauf_id` trennt man sie logisch), `reset_abrechnungslauf` löscht nichts mehr.
      - **Variante B (wie heute, wenig Speicher)**: Beim Erzeugen eines neuen Laufs werden zusätzlich **alle Bewegungsdaten bisheriger Läufe gelöscht**. Historische Informationen bleiben nur in Exporten erhalten.
    - Für deinen Wunsch „hart reset wie heute, aber Läufe benennbar“ wählen wir für den Start **Variante B**, halten aber die Architektur so, dass wir später auf A umstellen können.

### Frontend-Anpassungen (TypeScript/React)

- **DB-Layer (`src/db.ts`)**
  - Neue Typen:
    - `export type Abrechnungslauf = { id: string; name: string; start_zeitpunkt: string; end_zeitpunkt: string | null; is_aktiv: boolean; }`.
  - Neue Funktionen:
    - `getAbrechnungsläufe(): Promise<Abrechnungslauf[]>` → `invoke("get_abrechnungsläufe", ...)`.
    - `createAbrechnungslauf(name: string, start?: string): Promise<void>` → `invoke("create_abrechnungslauf", ...)`.
    - `deleteAbrechnungslauf(id: string): Promise<void>` → `invoke("delete_abrechnungslauf", ...)`.
  - Bestehende Funktionen (`getAbrechnung`, `getRecentAbrechnungen`, `getBuchungenForHaendler`, `getBuchungenForAbrechnung`) bleiben vom Interface her gleich, holen aber implizit den aktiven Lauf über die Commands.
- **Einstellungs-UI für Abrechnungsläufe**
  - In der bestehenden Einstellungen-View (z.B. `EinstellungenView.tsx`, falls vorhanden; sonst neuer Abschnitt) wird ein Bereich **„Abrechnungsläufe“** ergänzt:
    - Liste aller Läufe (Name, Zeitraum, Markierung welcher aktiv ist).
    - **Button „Neuen Abrechnungslauf starten“**:
      - Eingabefelder: Name (Pflicht), optional Startdatum (Standard = jetzt), erklärender Text, der auf den Reset hinweist.
      - Bestätigungsdialog (z.B. „Dieser Schritt löscht alle aktuellen Buchungen/Belege – bist du sicher?“).
    - **Aktion „Lauf löschen“** für nicht aktive Läufe:
      - Nur sichtbar, wenn der Lauf nicht aktiv ist.
      - Bestätigungsdialog (Lauf + alle zugehörigen Buchungen dieses Laufs werden gelöscht).
- **Abrechnung-/Händler-/Storno-Views**
  - `AbrechnungView.tsx`, `HaendlerMasterUebersichtView.tsx`, `HaendlerSlaveView.tsx`, `HaendlerBuchungenDrilldown.tsx`, `StornoView.tsx` müssen **fachlich nicht geändert werden**, da sie weiterhin „den aktuellen Abrechnungslauf“ anzeigen.
  - Optional (später): In diesen Views könnte ein schmaler Hinweis stehen wie „Aktueller Abrechnungslauf: {name} (seit {start_zeitpunkt})“.

### UX-Aspekte & Sicherheit

- **Klares Wording** im Einstellungen-Bereich:
  - Erklärung, dass **Stammdaten (Händler, Kassen)** erhalten bleiben.
  - Deutlich machen, dass ein neuer Lauf auf **0** startet und vorhandene Bewegungsdaten (Belege/Buchungen) des aktuellen Laufs gelöscht/archiviert werden.
- **Schutz vor Fehlbedienung**:
  - Doppelte Bestätigung für Start eines neuen Laufs (z.B. Name des Events eintippen oder Checkbox „Ich habe verstanden, dass…“).
  - Kein Löschen des aktiven Laufs.

### Entscheidungspunkte (für spätere Iterationen)

- Später können wir relativ einfach erweitern:
  - Historische Läufe **nicht** mehr löschen, sondern nur als „archiviert“ markieren (Spalte `archiviert` oder Endzeitpunkt ungleich NULL) und per Dropdown auswählbar machen.
  - In Abrechnung-/Händler-/Storno-Views eine **Lauf-Auswahl** einbauen (z.B. `Select-Lauf` oben rechts), die dann `lauf_id` in die Commands gibt.

### Grobe Umsetzungsschritte

- **Schritt 1: DB-Migration**
  - Neue Tabelle `abrechnungslauf`, Spalte `abrechnungslauf_id` in `kundenabrechnung` + FK.
  - Migrationen so gestalten, dass bei bestehenden Installationen ein **Default-Lauf** erstellt wird und allen vorhandenen `kundenabrechnung`-Zeilen diese Lauf-ID zugewiesen wird.
- **Schritt 2: Backend-Commands anpassen/erweitern**
  - `get_aktiver_abrechnungslauf_id`-Helper
  - Commands `get_abrechnungsläufe`, `create_abrechnungslauf`, `delete_abrechnungslauf`
  - Anpassung von `create_kundenabrechnung`, `get_haendler_umsatz`, `get_buchungen_for_haendler`, `get_recent_abrechnungen`, `get_buchungen_for_abrechnung` auf Filter nach aktivem Lauf.
- **Schritt 3: Frontend-DB-Layer erweitern**
  - Typ `Abrechnungslauf` + Wrapper-Funktionen für neue Commands.
- **Schritt 4: Einstellungs-UI für Abrechnungsläufe**
  - Liste, Start neuer Lauf (mit Bestätigung), Löschfunktion für alte Läufe.
- **Schritt 5: Kleine UX-Ergänzungen**
  - Optionaler Hinweis auf aktuellen Lauf in Abrechnung-/Händler-Views.

### Todos

- **db-migration-lauf**: Neue Tabelle `abrechnungslauf` + Spalte `abrechnungslauf_id` in `kundenabrechnung` mit Default-Lauf in Migration anlegen.
- **backend-commands-lauf**: Tauri-Commands für Abrechnungslauf-Management implementieren und bestehende Abrechnungs-/Drilldown-Commands auf `abrechnungslauf_id` umstellen.
- **frontend-db-lauf**: TypeScript-DB-Layer um `Abrechnungslauf`-Typ und zugehörige Funktionen erweitern.
- **settings-ui-lauf**: Einstellungs-UI für Abrechnungsläufe anlegen (Liste, neuer Lauf, Lauf löschen mit Bestätigungen).
- **ux-hinweis-aktueller-lauf**: Optionalen Hinweis auf den aktuellen Lauf in Abrechnung-/Händler-Views einbauen.

