---
name: nebnenkasse_buchungen_fehlen
overview: Buchungen der Nebenkasse werden ohne Fehlermeldung erfasst, tauchen aber weder in der Abrechnungsübersicht noch in der Storno-Ansicht auf. Der Plan fokussiert auf die Zuordnung neuer Kundenabrechnungen zu einem Abrechnungslauf und auf mögliche Sync-Probleme zwischen Slave und Master.
todos:
  - id: abrechnungslauf-zuordnung
    content: createKundenabrechnung setzt abrechnungslauf_id via getAktivenAbrechnungslaufId (db.ts)
    status: completed
isProject: false
---

### Ziel

Buchungen, die an der Nebenkasse erfasst werden, sollen zuverlässig im aktuell aktiven Abrechnungslauf erscheinen – sowohl in der Abrechnungsübersicht als auch in der Storno-Ansicht, lokal wie auf der Hauptkasse. Probleme sollen reproduzierbar eingegrenzt und mit minimal-invasiven Änderungen behoben werden.

### Kontext-Zusammenfassung

- Die Kasse (Master/Slave) erfasst Kundenabrechnungen über `KasseView` und `createKundenabrechnung` (in `[src/db.ts](src/db.ts)`).
- `createKundenabrechnung` legt Datensätze in `kundenabrechnung` und `buchungen` an, setzt aber aktuell kein `abrechnungslauf_id` in `kundenabrechnung`.
- Abrechnungs- und Storno-Ansichten (`AbrechnungView`, `StornoView`) greifen über Tauri-Commands (`get_haendler_umsatz`, `get_recent_abrechnungen`, `get_buchungen_for_abrechnung`) auf die DB zu und **filtern strikt** auf `kundenabrechnung.abrechnungslauf_id = <aktiver Lauf>`.
- Sync zwischen Nebenkasse und Hauptkasse erfolgt über `sync_db::get_batch` / `sync_db::apply_batch` (in `[src-tauri/src/sync/sync_db.rs](src-tauri/src/sync/sync_db.rs)`) inklusive Prüfung des Abrechnungslaufs.

### Grober Lösungsweg

1. **Problem reproduzierbar eingrenzen (lokal vs. Sync)**
  - Prüfen, ob neue Buchungen **lokal auf der Nebenkasse** im SQLite-File auftauchen, aber kein `abrechnungslauf_id` gesetzt ist.
  - Prüfen, ob dieselben Buchungen auf der Hauptkasse-DB ankommen (via Sync), und ob dort `abrechnungslauf_id` gesetzt oder NULL ist.
2. **Abrechnungslauf-Zuordnung beim Buchen korrigieren**
  - Beim Anlegen einer neuen `kundenabrechnung` in `createKundenabrechnung` den aktuellen aktiven Abrechnungslauf ermitteln (z.B. via `getAktivenAbrechnungslaufId`-Helper in `db.ts`, der den gleichen Command nutzt wie `getAbrechnung` / `AbrechnungView`).
  - Das ermittelte `abrechnungslauf_id` im `INSERT INTO kundenabrechnung` mit persistieren.
  - Sicherstellen, dass diese Logik sowohl für Master- als auch Slave-Instanzen identisch greift.
3. **Migration/Backfill für bestehende offene Buchungen (optional, je nach Bedarf)**
  - Falls bereits viele **neuere** Kundenabrechnungen ohne `abrechnungslauf_id` existieren, ein einmaliges Backfill-Skript/Command ergänzen, der für alle Belege mit `abrechnungslauf_id IS NULL` den aktuell aktiven Abrechnungslauf setzt (oder einen explizit ausgewählten Lauf).
  - Alternativ (wenn nicht benötigt): Nur zukünftige Buchungen korrekt zuordnen und die Historie so lassen.
4. **Sync-Pfade und Lauf-Konsistenz überprüfen**
  - Sicherstellen, dass `sync_db::get_batch` den für die Slave-Kasse aktiven Abrechnungslauf korrekt ermittelt und im Batch (`abrechnungslauf_id`) mitliefert.
  - In `sync_db::apply_batch` prüfen:
    - Verhalten, wenn `batch.abrechnungslauf_id` NULL ist (aktuell kann das zu stillen Ablehnungen oder inkonsistentem Zustand führen).
    - Ggf. explizite, gut sichtbare Fehlermeldung/Logging einbauen, falls `abrechnungslauf_id` nicht passt.
5. **UI-/UX-Verbesserungen für Fehlersichtbarkeit (nicht-invasiv)**
  - In `Startseite` und/oder `KasseView` prüfen, ob die Kasse einen aktiven Abrechnungslauf hat; falls nicht, klar erkennbare Warnung anzeigen (wird teilweise schon gemacht, ggf. schärfen).
  - Falls Sync-Batches wegen `abrechnungslauf_id` abgelehnt werden, einen deutlichen Hinweis in der UI (z.B. Banner im Slave-Startbildschirm) anzeigen, dass der Abrechnungslauf-Zustand mit der Hauptkasse nicht übereinstimmt.
6. **Gezielte Tests auf Slave und Master**
  - Reproduzierbare Test-Cases definieren (z.B. „neuer Lauf, eine Testbuchung auf Slave, in Abrechnung und Storno prüfen“).
  - Tests sowohl auf Nebenkasse selbst (lokale Abrechnung/Storno) als auch auf Hauptkasse (aggregierte Ansicht) durchführen.

### Relevante Dateien (für die Umsetzung)

- `src/components/KasseView.tsx` – Abschluss der Kundenabrechnung, Aufruf von `createKundenabrechnung` und Guards für aktiven Abrechnungslauf.
- `src/db.ts` – Implementierung von `createKundenabrechnung`, `getAbrechnung`, `getAbrechnungsläufe`, Sync-/Join-Hooks.
- `src/components/AbrechnungView.tsx` – Anzeige der Händler-Abrechnung über `getAbrechnung`.
- `src/components/StornoView.tsx` – Anzeige der jüngsten Kundenabrechnungen und Positionen (Stornos).
- `src/components/Startseite.tsx` – Steuerung Master/Slave-Start, Sync-Banner und Status.
- `src-tauri/src/commands.rs` – `get_haendler_umsatz`, `get_recent_abrechnungen`, `get_buchungen_for_abrechnung`, Abrechnungslauf-Kommandos.
- `src-tauri/src/sync/sync_db.rs` – `get_batch` / `apply_batch`, inkl. Prüfung `abrechnungslauf_id`.
- `src-tauri/migrations/006_abrechnungslauf.sql` – Schema-Definition `abrechnungslauf` und Verknüpfung zur `kundenabrechnung`.

### Datenfluss-Übersicht (Mermaid)

```mermaid
flowchart LR
  subgraph slaveApp [SlaveKasse]
    kasseView[KasseView "Abschließen"] --> createKA[createKundenabrechnung]
    createKA --> slaveDb["SQLite (Slave): kundenabrechnung + buchungen mit abrechnungslauf_id"]
    slaveDb --> slaveAbrechnung[AbrechnungView Slave]
    slaveDb --> slaveStorno[StornoView Slave]
  end

  slaveDb --> syncBatch[get_batch & send_batch]

  subgraph masterApp [Hauptkasse]
    syncBatch --> applyBatch[apply_batch]
    applyBatch --> masterDb["SQLite (Master): kundenabrechnung + buchungen"]
    masterDb --> masterAbrechnung[AbrechnungView Master]
    masterDb --> masterStorno[StornoView Master]
```

### Umsetzung (Kern umgesetzt)

In [db.ts](src/db.ts) `createKundenabrechnung`: vor dem INSERT wird `abrechnungslaufId = await getAktivenAbrechnungslaufId()` geladen und in `kundenabrechnung.abrechnungslauf_id` geschrieben. Damit erscheinen neue Buchungen (Master und Slave) im aktiven Lauf in Abrechnung und Storno. Sync und optionale UI-Hinweise bei Lauf-Mismatch können bei Bedarf separat ergänzt werden.



