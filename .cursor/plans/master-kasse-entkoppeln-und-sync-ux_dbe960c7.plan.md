---
name: master-kasse-entkoppeln-und-sync-ux
overview: Sicherheitsabfrage beim Entkoppeln in der Master-Kasse ergänzen und die Sync-/Verbindungsanzeige so verbessern, dass Probleme mit dem Master-Slave-Sync leichter erkennbar und verstehbar sind.
todos:
  - id: add-confirm-dialog-startseite
    content: Sicherheitsabfrage vor Entkoppeln in SyncStatusView.handleEntkoppeln einbauen
    status: completed
  - id: differentiate-sync-config-errors
    content: In Statuszeile und Startseite Sync-Fehler (nicht konfiguriert vs. keine Peers) klar unterscheiden und im UI anzeigen
    status: completed
  - id: improve-last-sync-display
    content: Darstellung von "Letzter Sync" (null/alt) in Startseite und SyncStatusView robuster und visuell deutlicher machen
    status: completed
  - id: sharpen-syncstatus-error-ui
    content: Fehleranzeige in SyncStatusView prominenter gestalten und ggf. mit Handlungsempfehlung (Einstellungen öffnen) versehen
    status: completed
isProject: false
---

## Ziel

- **Sicherheitsabfrage** vor dem Entkoppeln von Slave-Kassen in der Master-Kassenansicht (Startseite & Sync-Status-View).
- **Verbesserte Sync-/Statusanzeige**, damit klarer wird, ob ein technischer Fehler, eine fehlende Konfiguration oder nur ein temporärer Verbindungsabbruch vorliegt.

## Relevante Stellen im Code

- **Start-/Master-Ansicht & Entkoppeln-Button**: `[src/components/Startseite.tsx](src/components/Startseite.tsx)`
  - Master-Kassenliste mit Entkoppeln-Button pro Peer:

```213:251:/Users/lutz/workspace/kassensystem/src/components/Startseite.tsx
    {role === "master" && (
      <section className="startseite-kassenliste">
        <h2 className="startseite-kassenliste-title">Angemeldete Kassen</h2>
        {syncEntries.length === 0 ? (
          <p className="startseite-kassenliste-leer">Noch keine Kassen angemeldet.</p>
        ) : (
          <ul className="startseite-kassenliste-list">
            {syncEntries.map((e) => (
              <li key={e.peer_id} className="startseite-kassenliste-item">
                <span className="startseite-kassenliste-name">{e.name || e.peer_id}</span>
                <span
                  className={`startseite-kassenliste-badge ${e.connected ? "startseite-kassenliste-badge-ok" : "startseite-kassenliste-badge-warn"}`}
                >
                  {e.connected ? "Verbunden" : "Getrennt"}
                </span>
                <span className="startseite-kassenliste-time">
                  Letzter Sync: {formatZeit(e.last_sync)}
                </span>
                <button
                  type="button"
                  className="startseite-kassenliste-entkoppeln"
                  onClick={async () => {
                    setRemovingPeerId(e.peer_id);
                    try {
                      await removePeerFromNetwork(e.peer_id);
                      getSyncStatus().then(setSyncEntries);
                    } finally {
                      setRemovingPeerId(null);
                    }
                  }}
                  disabled={removingPeerId !== null}
                  title="Kasse vom Netzwerk entkoppeln"
                >
                  {removingPeerId === e.peer_id ? "…" : "Entkoppeln"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    )}
    

```

- **Sync-Status-Detailansicht mit Entkoppeln**: `[src/components/SyncStatusView.tsx](src/components/SyncStatusView.tsx)`

```47:58:/Users/lutz/workspace/kassensystem/src/components/SyncStatusView.tsx
    async function handleEntkoppeln(peerId: string) {
      setError("");
      setRemovingId(peerId);
      try {
        await removePeerFromNetwork(peerId);
        load();
      } catch (e) {
        setError(String(e));
      } finally {
        setRemovingId(null);
      }
    }
    

```

- **Sync-/Status-Backend-Kommandos**: `[src/db.ts](src/db.ts)`, `[src-tauri/src/commands.rs](src-tauri/src/commands.rs)`
  - `getSyncStatus`, `removePeerFromNetwork`, `startSyncConnections`, `get_sync_status`, `remove_peer_from_network`.

## Geplante Änderungen – Sicherheitsabfrage Entkoppeln

- **Einheitlicher Bestätigungsdialog für Master-Entkoppeln**
  - In `Startseite.tsx` den `onClick`-Handler des Entkoppeln-Buttons so erweitern, dass **vor** dem Setzen von `setRemovingPeerId` eine confirm-Abfrage erfolgt, z.B.:

```tsx
    if (!window.confirm("Sind Sie sicher, dass Sie die Verbindung zu dieser Kasse trennen möchten?")) {
      return;
    }
    

```

- Gleiches Muster in `SyncStatusView.tsx` innerhalb von `handleEntkoppeln` anwenden.
- Den Text bewusst **neutral und eindeutig** halten (Variante „Allgemeine Sicherheitsfrage“ wie von dir gewünscht), ohne zusätzliche Fachdetails, um die UI schlank zu halten.
- **Fehlertoleranz & Feedback beibehalten**
  - Die bestehende Fehlerbehandlung (`setError(String(e))` in `SyncStatusView`) unverändert lassen, nur vor den Netzwerkaufruf die Abfrage einschieben.
  - Den Lade-/Disabled-Zustand (`removingPeerId` / `removingId`) weiter nutzen, damit der Button während der Operation gesperrt bleibt.

## Geplante Verbesserungen – Sync-/Statusanzeige

### 1. Klarere Unterscheidung der Hauptfälle

- **Frontend-Logik (`Startseite.tsx`, `Statuszeile.tsx`, `SyncStatusView.tsx`) so erweitern**, dass folgende Zustände klar erkennbar sind:
  - **A)** Sync technisch gar nicht konfiguriert (z.B. `my_ws_url` oder `master_ws_url` fehlt → Backend-Error wie „Eigene Sync-URL nicht konfiguriert“).
  - **B)** Sync konfiguriert, aber aktuell **keine Verbindung** zu Peers (Peerliste leer oder alle `connected === false`).
  - **C)** Mindestens eine Kasse verbunden (Normalfall).
- **Konkrete UI-Ideen**:
  - In `Startseite.tsx` im Header (`syncSummary`) und im Slave-„Mit Master verbinden“-Bereich einen **zusätzlichen Text** anzeigen, wenn `getSyncStatus()` mit einem Konfigurationsfehler zurückkommt (z.B. Hinweis: „Sync noch nicht vollständig eingerichtet – bitte Einstellungen prüfen“).
  - In `Statuszeile.tsx` den Fall unterscheiden, ob `total === 0` aufgrund fehlender Konfiguration oder einfach, weil (noch) keine anderen Kassen im Netz sind. Dazu den Fehlertext von `getSyncStatus()` auswerten (z.B. eigener State `syncErrorType` mit Werten wie `"not_configured" | "ok" | "other_error"`).
  - In `SyncStatusView.tsx` die vorhandene `error`-Anzeige optisch hervorheben (z.B. separater Abschnitt über der Liste) und ggf. eine **kurze Handlungsempfehlung** ergänzen („Einstellungen öffnen“ Button, der auf `view === "einstellungen"` navigiert).

### 2. Besseres Verständnis von „Letzter Sync“

- **Anzeige „Letzter Sync“ präzisieren**, wenn der Zeitpunkt lange zurückliegt oder `null` ist:
  - Bei `last_sync === null`: Klarer Text wie „Noch kein Sync erfolgt“ statt Formatierungsversuch.
  - Wenn `last_sync` älter als z.B. 5 Minuten ist, visuell als Warnung markieren (z.B. andere CSS-Klasse), um zu zeigen, dass zwar `connected === true` war, aber schon länger kein Sync gelaufen ist.
- Diese Logik kann **rein im Frontend** in `Startseite.tsx` und `SyncStatusView.tsx` umgesetzt werden, auf Basis der bereits gelieferten Timestamps.

### 3. Sichtbarkeit von Hintergrundproblemen verbessern

- **Events und Polling sinnvoll nutzen**, ohne Backend-Architektur zu ändern:
  - Bestehendes Polling von `getSyncStatus()` (z.B. in `Statuszeile` alle 3,5s) beibehalten.
  - Wenn wiederholt ein Fehler beim Aufruf von `getSyncStatus()` auftritt, statt nur auf „0 von 0“ zu gehen, eine **klar beschriftete Fehlermeldung** anzeigen (z.B. „Sync-Status aktuell nicht abrufbar. Bitte Einstellungen prüfen oder Anwendung neu starten.“).
- Optional (wenn du möchtest, im nächsten Schritt):
  - Ein kleines **Debug-Info-Panel** im `SyncStatusView`, das zusätzlich die Rückgabe von `startSyncConnections` oder den letzten bekannten Start-Status zeigt (z.B. „Server gestartet, Sync zu 2 Peer(s) gestartet.“). Dazu könnte im Frontend einmalig bei App-Start der Rückgabestring gespeichert und hier angezeigt werden.

## Grobe Umsetzungsschritte

1. **Sicherheitsabfrage Entkoppeln**
  - In `[src/components/Startseite.tsx](src/components/Startseite.tsx)` den Entkoppeln-`onClick` um eine `window.confirm`-Abfrage ergänzen.
  - In `[src/components/SyncStatusView.tsx](src/components/SyncStatusView.tsx)` in `handleEntkoppeln` denselben Confirm-Dialog vorschalten.
2. **Sync-Konfigurations- und Fehlerzustände differenzieren**
  - In `[src/components/Statuszeile.tsx](src/components/Statuszeile.tsx)` den `getSyncStatus()`-Fehlerfall unterscheiden (z.B. anhand der Fehlermeldung `includes("Eigene Sync-URL nicht konfiguriert")`) und im UI statt „Keine Peers“ einen Hinweis „Sync nicht konfiguriert“ anzeigen.
  - In `[src/components/Startseite.tsx](src/components/Startseite.tsx)` analog einen kurzen Hinweistext ergänzen, wenn `getSyncStatus()` dauerhaft fehlschlägt.
3. **„Letzter Sync“-Anzeige robuster machen**
  - In `[src/components/Startseite.tsx](src/components/Startseite.tsx)` und `[src/components/SyncStatusView.tsx](src/components/SyncStatusView.tsx)` die Formatierung von `last_sync` anpassen:
    - `null` → „Noch kein Sync erfolgt“.
    - Alte Zeitpunkte → z.B. CSS-Klasse `time-stale`, die visuell eine Warnung darstellt.
4. **Fehler-/Status-UI im SyncStatusView schärfen**
  - In `[src/components/SyncStatusView.tsx](src/components/SyncStatusView.tsx)` den bestehenden `error`-State oben im View prominent anzeigen, inkl. einer kurzen Handlungsempfehlung (z.B. „Einstellungen öffnen“ über Callback-Prop oder Routing via `App.tsx`).

## Vereinfachtes Architekturbild

```mermaid
flowchart LR
  uiStartseite[Startseite] --> dbSync[getSyncStatus() in db.ts]
  uiStatuszeile[Statuszeile] --> dbSync
  uiSyncView[SyncStatusView] --> dbSync
  dbSync --> tauriGet[get_sync_status (Tauri-Command)]
  uiEntkoppeln[Entkoppeln-Buttons] --> dbRemove[removePeerFromNetwork()]
  dbRemove --> tauriRemove[remove_peer_from_network]
```



- **Bestätigungsdialog** wird ausschließlich in den UI-Knoten (`uiStartseite`, `uiSyncView`) ergänzt.
- **Sync-/Fehlerinterpretation** passiert im UI auf Basis der bestehenden Commands, ohne zusätzliche Backend-Aggregation.

Wenn du den Plan bestätigst, setze ich ihn Schritt für Schritt um und passe Startseite, SyncStatusView und Statuszeile entsprechend an.