---
name: slave_syncstatus_sofort_aktualisieren
overview: Beim Entkoppeln einer Kasse auf dem Master soll die Slave-Kasse den veränderten Kopplungsstatus sofort und klar sichtbar anzeigen, ohne auf Polling zu warten.
todos:
  - id: slave-syncdata-hook
    content: Startseite und Statuszeile auf der Slave-Kasse an SyncDataContext/sync-data-changed-Events koppeln, damit getSyncStatus direkt nach Entkoppeln neu geladen wird
    status: completed
  - id: slave-disconnect-message
    content: Optionale, klare Hinweiszeile auf der Slave-Startseite einbauen, wenn die Verbindung zum Master getrennt wurde
    status: completed
isProject: false
---

## Ziel

Wenn eine Kasse auf dem **Master** entkoppelt wird, soll die **Slave-Kasse** diese Änderung **sofort** sehen:

- Der Kopplungsstatus ("Verbunden" / "Nicht verbunden") soll ohne spürbare Verzögerung aktualisiert werden.
- Die Darstellung auf der Slave-Seite soll klar erkennbar machen, dass die Verbindung zum Master beendet wurde.

## Aktueller Stand (aus Codeanalyse)

- **Backend-Events**:
  - In `[src-tauri/src/commands.rs](src-tauri/src/commands.rs)` wird in `remove_peer_from_network` nach der Änderung der DB und des `sync_state` bereits ein Event gesendet:

```821:861:/Users/lutz/workspace/kassensystem/src-tauri/src/commands.rs
#[command]
pub async fn remove_peer_from_network(
    app: tauri::AppHandle,
    sync_conns: State<'_, SyncConnectionsState>,
    kassen_id: String,
) -> Result<(), String> {
    // ... DB-Update & sync_state löschen ...
    sync_conns.remove_peer(&kassen_id).await;

    let _ = app.emit("sync-data-changed", ());
    Ok(())
}
```

- Zusätzlich emittieren `sync/server.rs` und `sync/client.rs` ebenfalls `sync-data-changed`, wenn sich Sync-Daten verändern.
- **Frontend-Event-Handling**:
  - In `[src/SyncDataContext.tsx](src/SyncDataContext.tsx)` wird das Event global gehört und ein Zähler erhöht:

```1:23:/Users/lutz/workspace/kassensystem/src/SyncDataContext.tsx
const SyncDataContext = createContext<{ syncDataVersion: number }>({ syncDataVersion: 0 });

export function SyncDataProvider({ children }: { children: React.ReactNode }) {
  const [syncDataVersion, setSyncDataVersion] = useState(0);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen("sync-data-changed", () => {
      setSyncDataVersion((v) => v + 1);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <SyncDataContext.Provider value={{ syncDataVersion }}>
      {children}
    </SyncDataContext.Provider>
  );
}
```

- `Statuszeile.tsx` pollt `getSyncStatus` alle 3.5s und zeigt oben den Verbindungsstatus an, inklusive Hysterese:

```26:36:/Users/lutz/workspace/kassensystem/src/components/Statuszeile.tsx
  useEffect(() => {
    function load() {
      getSyncStatus()
        .then((entries) => {
          setSyncError(null);
          setTotal(entries.length);
          const c = entries.filter((e) => e.connected).length;
          setConnected(c);
          if (c > 0) setLastConnectedCount(c);
        })
        .catch((e) => {
          const msg = String(e);
          setSyncError(msg);
          setTotal(0);
          setConnected(0);
        });
    }
    load();
    const id = setInterval(load, 3500);
    return () => clearInterval(id);
  }, []);
```

- Die Slave-Startseite (`Startseite.tsx`) berechnet `slaveConnected` aus `syncEntries` und einer eigenen 8s-Hysterese; `syncEntries` werden dort aber ebenfalls nur alle 3.5s via `getSyncStatus` neu geladen.
- **Ergebnis**:
  - Backend-seitig gibt es bereits `sync-data-changed`-Events auch beim Entfernen einer Kasse.
  - Auf dem Slave wird der Verbindungsstatus aber aktuell nur durch **Polling** (`getSyncStatus` in `Startseite` und `Statuszeile`) aktualisiert, d.h. eine Entkopplung wird maximal nach ~3.5s sichtbar.

## Geplanter Ansatz

1. **Slave-Ansichten an `sync-data-changed` anhängen**
  - Auf der Slave-Kasse sollen relevante Views (mindestens `Startseite` und ggf. `Statuszeile`) zusätzlich zum bestehenden Polling explizit auf `sync-data-changed` reagieren.
  - Beim Eintreffen des Events wird `getSyncStatus()` sofort erneut aufgerufen, damit `syncEntries` / `connected` aktualisiert werden.
  - So bleibt das Polling als Fallback erhalten (z.B. falls mal ein Event verloren geht), aber Entkopplungen werden in der Praxis fast sofort sichtbar.
2. `**SyncDataContext` im Slave nutzen statt lokalen Polling-only-Status**
  - `SyncDataContext` stellt `syncDataVersion` zur Verfügung; Komponenten können diesen Wert als Trigger in `useEffect` einhängen.
  - Plan: In `Startseite` und/oder `Statuszeile` auf der Slave-Kasse `useSyncData()` einbinden und `syncDataVersion` als weitere Dependency in den `useEffect`-Hooks verwenden, die `getSyncStatus` laden.
  - Dadurch reicht ein einzelnes globales Event (`sync-data-changed`), um alle betroffenen Komponenten zu aktualisieren.
3. **Klarere UI-Rückmeldung auf dem Slave**
  - Wenn die Slave-Kasse durch Entkoppeln ihre Verbindung verliert, soll das dem Benutzer deutlich gemacht werden:
    - Statuszeile unten zeigt bereits `Nicht verbunden (0 von X Kassen)`; das wird durch die priläzisere Aktualisierung jetzt schneller sichtbar.
    - Optional: Auf der Slave-Startseite eine kurze Hinweiszeile einblenden (z.B. "Verbindung zum Master wurde getrennt – bitte erneut verbinden"), wenn `slaveConnected` von `true` auf `false` wechselt und `total`/`connected` entsprechend 0 sind.
4. **Seiteneffekte und Hysterese respektieren**
  - Die bestehende 8s-Hysterese für `slaveConnected` soll weiter funktionieren, um kurze Aussetzer nicht sofort als Disconnect zu zeigen.
  - Beim expliziten Entkoppeln vom Master (Kasse entfernt) wird der Slave allerdings dauerhaft 0 Peers sehen; nach Ablauf der Hysterese wird der Status dann sauber auf "nicht verbunden" wechseln.
  - Durch das Event-getriggerte `getSyncStatus` wird dieser Übergang bereits kurz nach dem Entfernen sauber vorbereitet.

## Konkrete Umsetzungsschritte (wenn du den Plan freigibst)

1. `**SyncDataContext` im App-Tree verifizieren**
  - Prüfen, wo im React-Tree `SyncDataProvider` eingebunden ist (vermutlich in `App.tsx` o.ä.), und sicherstellen, dass `Startseite` und `Statuszeile` (auch auf dem Slave) darunter liegen.
2. **Startseite (Slave) an `syncDataVersion` koppeln**
  - In `[src/components/Startseite.tsx](src/components/Startseite.tsx)` `useSyncData` importieren und aufrufen.
  - Den `useEffect`, der `getSyncStatus()` lädt, so erweitern, dass er zusätzlich auf `syncDataVersion` lauscht und bei Änderung `load()` erneut ausführt.
  - Optional: Nur für `role === "slave"` den Event-Trigger berücksichtigen, damit das Master-Verhalten unverändert bleibt.
3. **Statuszeile an `syncDataVersion` koppeln**
  - In `[src/components/Statuszeile.tsx](src/components/Statuszeile.tsx)` ebenfalls `useSyncData` nutzen.
  - Den `useEffect`, der `getSyncStatus()` pollt, so erweitern, dass bei Änderung von `syncDataVersion` sofort ein zusätzliches `load()` durchgeführt wird (Polling bleibt als Fallback).
4. **Optionale Slave-Hinweismeldung bei Disconnect**
  - In `Startseite` (nur `role === "slave"`): Wenn `!slaveConnected` und `syncSummary` (`total`, `connected`) zeigen, dass keine Master-Verbindung mehr besteht, eine klar sichtbare Info einblenden (z.B. oberhalb des "Mit Master verbinden"-Blocks).
  - Text z.B.: "Verbindung zum Master wurde getrennt – bitte erneut verbinden." oder ähnlich.
5. **Tests**
  - Zwei Instanzen starten (Master & Slave), Slave erfolgreich koppeln.
  - Auf dem Master eine Kasse über "Entkoppeln" entfernen.
  - Prüfen, dass:
    - Auf dem Slave die Statuszeile den geänderten Verbindungsstatus nach sehr kurzer Zeit (durch Event) anzeigt.
    - Die Slave-Startseite konsistent denselben Status zeigt (inkl. Hysterese-Verhalten).
    - Keine unerwünschten zusätzlichen Polling-Bursts oder UI-Flackern auftreten.

