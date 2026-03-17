---
name: entkoppeln_cancel_pruefen
overview: Analyse und Korrektur der Entkoppeln-Logik, sodass ein Klick auf „Cancel/Abbrechen“ im Bestätigungsdialog zuverlässig verhindert, dass eine Kasse aus dem Netzwerk entfernt wird.
todos:
  - id: entkoppeln-context-clarify
    content: Entkoppeln-Logik in Startseite und SyncStatusView so refaktorisieren, dass der Confirm-/Cancel-Flow eindeutig und robust ist
    status: completed
  - id: entkoppeln-manual-test
    content: Beide Entkoppeln-Pfade manuell testen (OK vs. Cancel) und sicherstellen, dass Cancel nie zum Entfernen führt
    status: completed
isProject: false
---

## Ziel

Sicherstellen, dass beim Klick auf „Entkoppeln“ und anschließendes Abbrechen des Bestätigungsdialogs ("Cancel"/"Abbrechen") **keine** Kasse aus dem Netzwerk entfernt wird – weder auf der Startseite noch im Sync-Status.

## Aktueller Stand (Analyse)

- **Startseite-Entkoppeln-Button**: In `[src/components/Startseite.tsx](src/components/Startseite.tsx)` wird die Entfernung aktuell direkt im `onClick`-Handler umgesetzt:

```259:275:/Users/lutz/workspace/kassensystem/src/components/Startseite.tsx
                  <button
                    type="button"
                    className="startseite-kassenliste-entkoppeln"
                    onClick={async () => {
                      if (
                        !window.confirm(
                          "Sind Sie sicher, dass Sie die Verbindung zu dieser Kasse trennen möchten?"
                        )
                      ) {
                        return;
                      }
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
```

- **Sync-Status-Entkoppeln-Button**: In `[src/components/SyncStatusView.tsx](src/components/SyncStatusView.tsx)` ist die Logik sehr ähnlich gekapselt:

```53:70:/Users/lutz/workspace/kassensystem/src/components/SyncStatusView.tsx
  async function handleEntkoppeln(peerId: string) {
    if (
      !window.confirm(
        "Sind Sie sicher, dass Sie die Verbindung zu dieser Kasse trennen möchten?"
      )
    ) {
      return;
    }
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

- **Backend-Aufruf**: In `[src/db.ts](src/db.ts)` wird `removePeerFromNetwork` lediglich an den Tauri-Command durchgereicht:

```381:383:/Users/lutz/workspace/kassensystem/src/db.ts
export async function removePeerFromNetwork(kassenId: string): Promise<void> {
  await invoke("remove_peer_from_network", { kassenId });
}
```

- **Ergebnis der Analyse**: Aus reinem Code-Review ist die Logik korrekt: Wenn `window.confirm` `false` zurückgibt (bei „Cancel“), wird die Funktion vor dem Aufruf von `removePeerFromNetwork` per `return` beendet. Ein Entfernen der Kasse dürfte **nicht** stattfinden. Das von dir beobachtete Verhalten weist darauf hin, dass entweder
  - das Problem in einer anderen Code-Version/anderen Stellen liegt,
  - der Dialog nicht der `window.confirm`-Dialog ist (z.B. nativer/anderer Dialog),
  - oder ein unerwartetes Timing-/State-Problem (z.B. mehrfacher Klick, Race Condition) vorliegt.

## Geplanter Fix / Verbesserungen

- **1. Reproduktions-Szenario eingrenzen**
  - Prüfen, **aus welcher View** das beobachtete Verhalten kommt (Startseite vs. `SyncStatusView`).
  - Testfälle manuell durchspielen:
    - Einmal klick auf „Entkoppeln“ → im Dialog „Abbrechen“ → Kasse muss erhalten bleiben.
    - Wiederholtes, schnelles Klicken auf „Entkoppeln“ mit unterschiedlichen Antworten, um Race Conditions auszuschließen.
- **2. Bestätigungslogik robuster machen**
  - Die Bestätigung aus dem Inline-Handler extrahieren, sodass der Flow eindeutig ist:
    - Separate Funktion `confirmRemovePeer(...)` die explizit einen `boolean` zurückgibt und nur bei `true` `removePeerFromNetwork` aufruft.
    - Dadurch weniger Risiko für versehentliche Änderungen im `onClick`-Inline-Handler.
  - Optional: Statt `window.confirm` einen eigenen React-Dialog verwenden (wie Join-Dialog in `Startseite`), bei dem klar ist, dass `Abbrechen` den `onConfirm`-Callback **nicht** auslöst.
- **3. UI-Zustand gegen Mehrfachklicks absichern**
  - Sicherstellen, dass der „Entkoppeln“-Button sofort nach dem ersten Klick deaktiviert ist (wird bereits über `disabled={removingPeerId !== null}` gemacht).
  - Falls nötig, `removingPeerId` schon **vor** dem `confirm`-Dialog vorsetzen und bei Abbruch wieder zurücksetzen, um sowohl visuelles Feedback als auch Click-Blocking zu haben.
- **4. Smoke-Tests / manuelle Checks**
  - Nach der Anpassung beide Entkoppeln-Pfade (Startseite & Sync-Status) durchtesten.
  - Speziell verifizieren:
    - „Abbrechen“ → kein Aufruf von `removePeerFromNetwork` (konzeptionell, ggf. per Logging/Devtools überprüfbar).
    - „OK“ → Aufruf von `removePeerFromNetwork` und korrekte Aktualisierung der Liste via `getSyncStatus`/`load()`.

## Umsetzungsschritte (wenn Plan freigegeben)

- **Startseite**
  - Den Inline-`onClick`-Block in `Startseite.tsx` auf eine kleine Hilfsfunktion auslagern und dabei den Bestätigungs-/Abbruchflow klar trennen.
- **SyncStatusView**
  - Die vorhandene `handleEntkoppeln`-Funktion ggf. vereinheitlichen mit der neuen Hilfsfunktion (oder gleiche Struktur übernehmen), um doppelte, divergierende Logik zu vermeiden.
- **Tests & Verifizierung**
  - Anwendung starten, Entkoppeln mit „Abbrechen“ in beiden Views testen.
  - Ergebnisse dokumentieren und sicherstellen, dass keine unbeabsichtigte Entkopplung mehr stattfindet.

