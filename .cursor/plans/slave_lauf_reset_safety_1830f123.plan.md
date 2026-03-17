---
name: slave_lauf_reset_safety
overview: Lokalen Abrechnungslauf auf Nebenkassen sicher leeren, Buchungen nur bei abgestimmter Hauptkasse erlauben und dennoch Offline-Buchungen plus vollständige Synchronisation sicherstellen.
todos:
  - id: init-flag-master-slave
    content: Initialisierungs-Flag für abgestimmte Kasse (config `initialized_from_master`) einführen und in setupMaster / join_network setzen.
    status: completed
  - id: kasseview-buchungen-guard
    content: In KasseView prüfen, ob Kasse initialisiert und ein aktiver Abrechnungslauf vorhanden ist, bevor Buchungen erlaubt werden.
    status: completed
  - id: request-slave-reset-command
    content: Neuen Master-Command `request_slave_reset` implementieren, der vor Reset prüft, ob alle Sequenzen des Slaves repliziert sind und dann `AbrechnungslaufReset` auslöst.
    status: completed
  - id: slave-settings-reset-ui
    content: In der Nebenkassen-Einstellungs-UI einen "Lokalen Abrechnungslauf leeren"-Flow implementieren, der `request_slave_reset` nutzt und klare Warn-/Bestätigungstexte anzeigt.
    status: completed
  - id: optional-peers-sync-check
    content: "Optional: Master prüft beim Reset zusätzlich, ob andere Peers ebenfalls den vollständigen Sequenzstand des Slaves kennen, bevor der Reset erlaubt wird."
    status: cancelled
isProject: false
---

### Zielbild

- **Nebenkassen** sollen einen lokalen Abrechnungslauf "leeren" können, aber **nur so**, dass keine noch nicht replizierten Daten versehentlich verloren gehen.
- Nebenkassen dürfen **nur dann Buchungen erfassen**, wenn sie initial mit einer Hauptkasse abgestimmt und für einen gemeinsamen Abrechnungslauf eingerichtet wurden.
- Bei **Netzwerkausfall** muss eine Kasse weiter lokal buchen können, damit der Betrieb nicht steht; später wird über Sync der vollständige Verbundstand aufgebaut.
- Alle Knoten im Verbund dienen als **Redundanz** (vollständige Kopien der Daten), insbesondere Master und mindestens eine weitere Kasse.

---

### Bestehende Architektur (relevant)

- Sync-Mechanismus (`sync_db.rs`, `server.rs`, `client.rs`):
  - Basiert auf `kundenabrechnung.sequence` pro Kasse und `sync_state` mit `peer_kassen_id` + `last_sequence`.
  - Batches (`KundenabrechnungBatch`) replizieren Belege + Buchungen.
  - Stornos werden separat über `StornoBatch` synchronisiert.
- Abrechnungsläufe:
  - Tabelle `abrechnungslauf` verwaltet systemweiten Lauf (inkl. ID, Name, Start, Ende, `is_aktiv`).
  - Master startet neue Läufe und broadcastet diese per `AbrechnungslaufReset` an Slaves.
  - Join-Flow sorgt dafür, dass Slaves den aktiven Lauf vom Master übernehmen; Join wird abgelehnt, wenn der Slave schon eigene Buchungen hat.

---

### Kernidee: Löschen nur, wenn Daten sicher repliziert sind

Um zu verhindern, dass eine Nebenkasse versehentlich Daten löscht, die anderswo noch **nicht** vorhanden sind, definieren wir klare Regeln:

1. **Slave darf seinen Lauf nur über einen Master-gesteuerten Reset leeren**
  - Es gibt **keinen direkten "hart löschen"-Button** in der Nebenkasse, der lokal einfach `kundenabrechnung`/`buchungen` leert.
  - Stattdessen initiiert der Slave einen **Reset-Antrag an den Master**:
    - Neuer Command z.B. `request_slave_reset(kassen_id)` auf dem Master.
    - Der Master prüft anhand von `sync_state` / `sequence`-Werten, ob **alle bisherigen Buchungen des Slaves bereits central (mindestens auf Master) angekommen** sind.
      - Beispiel: Master kennt für diese `kassen_id` `max_sequence_slave` und seinen eigenen `max_sequence` für diese Kasse; Reset ist nur erlaubt, wenn `max_sequence_master >= max_sequence_slave`.
    - Wenn diese Bedingung nicht erfüllt ist, verweigert der Master den Reset mit einer klaren Meldung: "Es liegen noch nicht replizierte Buchungen vor." – der Slave kann dann **nicht** leeren.
2. **Nur Master sendet den eigentlichen Reset-Befehl**
  - Wenn der Reset zulässig ist, sendet der Master an den entsprechenden Slave eine `AbrechnungslaufReset`-Message (die bereits existiert) **mit neuer Lauf-ID / Name / Start**.
  - Auf dem Slave werden im Handler (`apply_abrechnungslauf_reset`) die Daten gelöscht **und** der neue Lauf gesetzt.
  - Vorteil: Alle Löschungen passieren in einem wohldefinierten, synchronisierten Kontext; die Nebenkasse löscht nicht „auf eigene Faust“.
3. **Offline-Szenario**
  - Wenn die Nebenkasse **offline** ist:
    - Sie kann **weiter buchen**, da der aktuelle Lauf lokal in `abrechnungslauf` existiert.
    - **Ein lokaler Reset ist in diesem Zustand nicht möglich**, da der Master nicht prüfen kann, ob alle Daten repliziert sind.
  - Erst wenn wieder eine Verbindung zum Master besteht und der Master bestätigt, dass alle Sequenzen angekommen sind, kann ein Reset-Antrag erfolgreich sein.

---

### Buchungen nur bei initial abgestimmter Kasse zulassen

1. **Initialisierungs-Flag für "abgestimmte" Kasse**
  - Einführung eines einfachen Flags (z.B. in `config`): `initialized_from_master = "true"`.
  - Dieses Flag wird gesetzt, wenn:
    - `setupMaster` erfolgreich durchgelaufen ist (Hauptkasse), oder
    - `join_network` auf der Nebenkasse erfolgreich war und der Master-Lauf übernommen wurde.
  - Nebenkassen ohne dieses Flag gelten als **nicht initialisiert**.
2. **KasseView-Buchungslogik härten**
  - In `KasseView.tsx` (beim Erzeugen einer Kundenabrechnung) zusätzlich prüfen:
    - `initialized_from_master` ist `true` **und**
    - es existiert ein aktiver `abrechnungslauf` in der lokalen DB (über bereits existierende Commands/Abrechnungs-API indirekt prüfbar oder explizit per neuem Helper).
  - Wenn nicht erfüllt:
    - Buchungen werden **nicht zugelassen**, und der Benutzer sieht eine eindeutige Meldung: „Diese Kasse ist noch nicht mit der Hauptkasse abgestimmt. Bitte zuerst Join durchführen.“
  - So kann eine Nebenkasse nicht in einem "wilden" Zustand Buchungen erzeugen, die keinem gemeinsamen Lauf zugeordnet sind.
3. **Trotzdem Offline-Buchungen ermöglichen**
  - Sobald ein Slave einmal korrekt initialisiert ist (Flag gesetzt, Lauf vorhanden), darf er auch **offline weiter buchen**:
    - Die Prüfung auf `initialized_from_master` bleibt erfüllt, auch wenn die Verbindung kurzzeitig weg ist.
    - Die Buchungen werden später über Sync nachgezogen.

---

### Synchronisations- und Sicherungskonzept

- **Daten liegen redundant** auf Master und Slaves:
  - Durch den existierenden Sync-Mechanismus werden alle Buchungen in den Verbund gespiegelt, solange periodisch Verbindungen bestehen.
- Der oben beschriebene Reset-Prozess stellt sicher:
  - Ein Slave darf **nur dann** auf 0 gesetzt werden, wenn seine Daten **mindestens** auf dem Master vorhanden sind (und somit in der Verbund-Abrechnung berücksichtigt werden können).
  - Optional kann der Master sogar prüfen, ob **alle** anderen Peers die Sequenzen ebenfalls haben (z.B. indem er deren `sync_state` für diese `kassen_id` auswertet) und den Reset sonst verweigern.

---

### UX-Flows zur Sicherheit für Nutzer

1. **Slave-Einstellungen: "Lokalen Lauf leeren"**
  - In der Einstellungs-View der Nebenkasse ein Punkt:
    - „Lokalen Abrechnungslauf leeren (nach Sicherung)“
  - Klick öffnet Dialog:
    - Erklärt, dass:
      - alle lokalen Buchungen gelöscht werden,
      - dies nur möglich ist, wenn die Hauptkasse alle Buchungen schon erhalten hat.
    - Button „Reset-Anfrage an Hauptkasse senden“.
  - Backend-Flow:
    - Frontend ruft `request_slave_reset` auf (neuer Command), dieser läuft auf dem Master wie oben beschrieben.
    - Bei Erfolg: Master triggert `AbrechnungslaufReset` → Slave wird geleert & neuer Lauf gesetzt.
    - UI zeigt Erfolgsmeldung bzw. genaue Fehlermeldung (z.B. „Es sind noch nicht replizierte Buchungen vorhanden, bitte später erneut versuchen.“).
2. **Deutliche Hinweise vor kritischen Aktionen**
  - Sowohl auf Master als auch Slave vor Abrechnungslauf-Resets immer mit Klartext:
    - Was bleibt erhalten (Stammdaten, Kassen, Einstellungen).
    - Was verloren geht (Belege/Buchungen dieses Laufs, lokale Stornos, Belegzähler).

---

### Wie verhindert das versehentliches Löschen lokaler Daten?

- **Kein direkter Löschknopf am Slave**: Der Nutzer kann nicht einfach lokal alles löschen; der Weg führt immer über den Master.
- **Technische Prüfung vor Reset**: Der Master erlaubt einen Reset nur, wenn seine `sync_state` zeigt, dass alle Sequenzen des Slaves angekommen sind (und optional: alle relevanten Peers ebenfalls up-to-date sind).
- **Offline keine Reset-Möglichkeit**: Bei Netzwerkausfall ist gerade **kein Reset** möglich, nur weitere Buchungen – so gehen keine lokalen Daten verloren, bevor sie gesichert sind.
- **Klare UI und Bestätigungen**: Nutzer verstehen, dass ein Reset erst nach erfolgreicher Synchronisation und mit ausdrücklicher Bestätigung passiert.

---

### Zusammenfassung als Schritte

1. Flag `initialized_from_master`/Äquivalent einführen und in `setupMaster`/`join_network` setzen.
2. `KasseView.tsx` so absichern, dass Buchungen nur bei gesetztem Flag + vorhandenem aktiven Lauf möglich sind.
3. Neuen Master-Command `request_slave_reset` definieren, der prüft, ob alle Sequenzen eines Slaves repliziert sind, und nur dann einen `AbrechnungslaufReset` anstößt.
4. Slave-Einstellungs-UI um einen sicheren "Reset anfragen"-Flow ergänzen (keine direkte lokale Löschung).
5. Optionale Verfeinerung: Master prüft auch Replikationsstand auf weiteren Peers, um maximale Datensicherheit zu erreichen.

Damit wird funktional umgesetzt, was du beschreibst: Slaves können offline weiterarbeiten, alle Daten werden im Verbund gesichert, und ein versehentliches Löschen nicht replizierter lokaler Daten wird technisch und per UX weitgehend ausgeschlossen.