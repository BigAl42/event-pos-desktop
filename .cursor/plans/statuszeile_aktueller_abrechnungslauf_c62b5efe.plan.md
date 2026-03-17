---
name: statuszeile_aktueller_abrechnungslauf
overview: Zeigt in der Statusleiste (Statuszeile) den für diese Kasse aktuell aktiven Abrechnungslauf mit Namen an.
todos: []
isProject: false
---

### Ziel

- In der Statusleiste (`Statuszeile.tsx`) soll **immer sichtbar** sein, welcher **Abrechnungslauf** aktuell für die Kasse gilt, inkl. Name (z.B. "Stadtfest 2026").
- Die Anzeige soll sowohl auf der Hauptkasse als auch auf Nebenkassen funktionieren und sich automatisch aktualisieren, wenn ein neuer Lauf gestartet oder per Sync/Reset übernommen wird.

### Bestehende Basis

- Backend/DB:
  - Tabelle `abrechnungslauf` mit Spalten `id`, `name`, `start_zeitpunkt`, `end_zeitpunkt`, `is_aktiv` (Migration 006).
  - Command `get_abrechnungsläufe` liefert alle Läufe inkl. `is_aktiv` (`src-tauri/src/commands.rs`).
- Frontend-DB-Layer (`src/db.ts`):
  - Typ `Abrechnungslauf` und Funktion `getAbrechnungsläufe()` existieren bereits.
- Statusleiste (`src/components/Statuszeile.tsx`):
  - Zeigt aktuell Rolle, Kassenname und Sync-Status (verbundene Kassen, Join-Requests), nutzt `getConfig`, `getSyncStatus`, `getJoinRequests` und `useSyncData` (für `syncDataVersion`).

### Geplante Umsetzung

1. **Abrechnungslauf im DB-Layer nutzen**
  - `Statuszeile.tsx` zusätzlich `getAbrechnungsläufe` und Typ `Abrechnungslauf` aus `../db` importieren.
2. **Aktuellen Lauf in Statuszeile laden**
  - In `Statuszeile.tsx` einen neuen State anlegen, z.B.:
    - `const [aktuellerLaufName, setAktuellerLaufName] = useState<string | null>(null);`
  - In einem `useEffect` beim Mount (und wenn sich `syncDataVersion` ändert) `getAbrechnungsläufe()` aufrufen:
    - Aus der zurückgegebenen Liste den Eintrag mit `is_aktiv === true` suchen.
    - Dessen `name` in `setAktuellerLaufName` speichern.
    - Falls kein aktiver Lauf gefunden oder Fehler: `aktuellerLaufName` auf `null` setzen.
  - Den bestehenden `useEffect`, der schon auf `syncDataVersion` reagiert (für `getSyncStatus`), entweder erweitern oder einen separaten, kleinen Effekt hinzufügen, der parallel `getAbrechnungsläufe` lädt.
3. **Anzeige im Footer ergänzen**
  - Im JSX von `Statuszeile` (im `<footer>`), nach Rolle/Kassenname und Sync-Status, ein zusätzliches Segment einfügen, z.B.:
    - Wenn `aktuellerLaufName` vorhanden ist:
      - `· Aktueller Abrechnungslauf: <strong>{aktuellerLaufName}</strong>`
    - Wenn keiner gefunden wurde, gar nichts anzeigen oder einen sehr dezenten Platzhalter wie "Kein Abrechnungslauf gesetzt" (optional – besser weglassen, um UI ruhig zu halten).
  - Beispiel-Layout:
    - `Hauptkasse – Kasse 1 · Verbunden mit 1 von 2 Kassen · Aktueller Abrechnungslauf: Stadtfest 2026`
4. **Aktualität sicherstellen**
  - Durch die Kopplung an `syncDataVersion` in `Statuszeile` wird der Lauf neu geladen, wenn:
    - ein neuer Lauf auf der Hauptkasse gestartet wird (Master),
    - ein `AbrechnungslaufReset`-Event auf Slaves ankommt und `sync-data-changed` emittiert wird,
    - Sync-Batches angewendet werden.
  - Optional: zusätzlich `getAbrechnungsläufe` im Intervall (z.B. alle 30–60s) neu laden; in der ersten Version genügt aber die Reaktion auf `syncDataVersion`.
5. **Fehlerhandling (UX)**
  - Scheitert `getAbrechnungsläufe`, wird **kein eigener Fehler in der Statuszeile angezeigt**, sondern `aktuellerLaufName` bleibt `null`.
  - So bleibt die bestehende Sync-Statusanzeige unverändert und die Lauf-Info ist ein zusätzlicher, unkritischer Komfort.

### Todos

- **statuslauf-import**: `Statuszeile.tsx` so erweitern, dass `getAbrechnungsläufe` und Typ `Abrechnungslauf` importiert und genutzt werden.
- **statuslauf-state-und-effekt**: State und `useEffect` in `Statuszeile.tsx` anlegen, die den aktiven Abrechnungslauf laden und bei `syncDataVersion`-Änderungen aktualisieren.
- **statuslauf-anzeige**: Im Footer von `Statuszeile.tsx` ein neues Textsegment einbauen: „Aktueller Abrechnungslauf: {name}“ (nur wenn vorhanden).

