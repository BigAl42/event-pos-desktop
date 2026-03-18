import { useState, useEffect } from "react";
import { hasKasse, getConfig, startMasterServer, isMasterServerRunning, startSyncConnections } from "./db";
import { SyncDataProvider } from "./SyncDataContext";
import { SyncStatusProvider } from "./SyncStatusContext";
import Startseite from "./components/Startseite";
import ErststartDialog from "./components/ErststartDialog";
import KasseView from "./components/KasseView";
import AbrechnungView from "./components/AbrechnungView";
import EinstellungenView from "./components/EinstellungenView";
import HaendlerverwaltungView from "./components/HaendlerverwaltungView";
import HaendlerSlaveView from "./components/HaendlerSlaveView";
import HaendlerBuchungenDrilldown from "./components/HaendlerBuchungenDrilldown";
import HaendlerMasterUebersichtView from "./components/HaendlerMasterUebersichtView";
import JoinAnfragenView from "./components/JoinAnfragenView";
import StornoView from "./components/StornoView";
import SyncStatusView from "./components/SyncStatusView";
import Statuszeile from "./components/Statuszeile";

export type View =
  | "start"
  | "kasse"
  | "abrechnung"
  | "storno"
  | "sync_status"
  | "einstellungen"
  | "haendler"
  | "haendler_slave"
  | "haendler_drilldown"
  | "haendler_master_uebersicht"
  | "haendler_master_drilldown"
  | "haendler_stammdaten"
  | "join_anfragen";

function App() {
  const [setupDone, setSetupDone] = useState<boolean | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [view, setView] = useState<View>("start");
  const [drilldownHaendler, setDrilldownHaendler] = useState<{ nummer: string; name: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setSetupDone(await hasKasse());
      } catch (e) {
        setSetupError(String(e));
      }
    })();
  }, []);

  useEffect(() => {
    if (!setupDone) return;
    (async () => {
      const role = await getConfig("role");
      if (role !== "master" && role !== "slave") return;

      // Hauptkasse: WebSocket-Server autostarten, aber nur wenn sauber konfiguriert.
      if (role === "master") {
        try {
          const running = await isMasterServerRunning();
          if (!running) {
            const portStr = await getConfig("ws_server_port");
            const myWsUrl = await getConfig("my_ws_url");
            const port = portStr ? parseInt(portStr, 10) : NaN;
            if (myWsUrl && Number.isFinite(port) && port >= 1 && port <= 65535) {
              await startMasterServer(port);
            }
          }
        } catch (_) {
          // Autostart ist best-effort; manuell in Einstellungen möglich.
        }
      }

      // Sync autostarten, aber nur wenn eigene Sync-URL gesetzt ist.
      try {
        const myWsUrl = await getConfig("my_ws_url");
        if (myWsUrl && myWsUrl.trim()) {
          await startSyncConnections();
        }
      } catch (_) {
        // Sync-URL oder Peers ggf. noch nicht konfiguriert; ignorieren
      }
    })();
  }, [setupDone]);

  if (setupError) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>Start fehlgeschlagen</h2>
        <p>Die Anwendung konnte nicht initialisiert werden.</p>
        <pre style={{ whiteSpace: "pre-wrap" }}>{setupError}</pre>
      </div>
    );
  }

  if (setupDone === null) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        Lade…
      </div>
    );
  }

  if (!setupDone) {
    return (
      <ErststartDialog
        onDone={() => {
          setSetupDone(true);
        }}
      />
    );
  }

  return (
    <SyncDataProvider>
      <SyncStatusProvider>
        <div className="app-layout">
          <main className="app-main">
            {view === "kasse" && <KasseView onBack={() => setView("start")} />}
            {view === "abrechnung" && <AbrechnungView onBack={() => setView("start")} />}
            {view === "storno" && <StornoView onBack={() => setView("start")} />}
            {view === "sync_status" && (
              <SyncStatusView
                onBack={() => setView("start")}
                onOpenEinstellungen={() => setView("einstellungen")}
              />
            )}
            {view === "einstellungen" && <EinstellungenView onBack={() => setView("start")} />}
            {view === "haendler" && <HaendlerverwaltungView onBack={() => setView("start")} />}
            {view === "haendler_stammdaten" && (
              <HaendlerverwaltungView onBack={() => setView("haendler_master_uebersicht")} />
            )}
            {view === "haendler_master_uebersicht" && (
              <HaendlerMasterUebersichtView
                onBack={() => setView("start")}
                onOpenDrilldown={(nummer, name) => {
                  setDrilldownHaendler({ nummer, name });
                  setView("haendler_master_drilldown");
                }}
                onOpenStammdaten={() => setView("haendler_stammdaten")}
              />
            )}
            {view === "haendler_slave" && (
              <HaendlerSlaveView
                onBack={() => setView("start")}
                onOpenDrilldown={(nummer, name) => {
                  setDrilldownHaendler({ nummer, name });
                  setView("haendler_drilldown");
                }}
              />
            )}
            {view === "haendler_drilldown" && drilldownHaendler && (
              <HaendlerBuchungenDrilldown
                haendlernummer={drilldownHaendler.nummer}
                haendlerName={drilldownHaendler.name}
                onClose={() => setView("haendler_slave")}
              />
            )}
            {view === "haendler_master_drilldown" && drilldownHaendler && (
              <HaendlerBuchungenDrilldown
                haendlernummer={drilldownHaendler.nummer}
                haendlerName={drilldownHaendler.name}
                onClose={() => setView("haendler_master_uebersicht")}
              />
            )}
            {view === "join_anfragen" && <JoinAnfragenView onBack={() => setView("start")} />}
            {view === "start" && (
              <Startseite
                onOpenKasse={() => setView("kasse")}
                onOpenAbrechnung={() => setView("abrechnung")}
                onOpenStorno={() => setView("storno")}
                onOpenSyncStatus={() => setView("sync_status")}
                onOpenEinstellungen={() => setView("einstellungen")}
                onOpenHaendler={() => setView("haendler")}
                onOpenHaendlerMaster={() => setView("haendler_master_uebersicht")}
                onOpenHaendlerSlave={() => setView("haendler_slave")}
                onOpenJoinAnfragen={() => setView("join_anfragen")}
              />
            )}
          </main>
          <Statuszeile onOpenJoinAnfragen={() => setView("join_anfragen")} />
        </div>
      </SyncStatusProvider>
    </SyncDataProvider>
  );
}

export default App;
