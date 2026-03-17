import { useState, useEffect } from "react";
import { hasKasse, getConfig, startSyncConnections } from "./db";
import { SyncDataProvider } from "./SyncDataContext";
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
  const [view, setView] = useState<View>("start");
  const [drilldownHaendler, setDrilldownHaendler] = useState<{ nummer: string; name: string } | null>(null);

  useEffect(() => {
    hasKasse().then(setSetupDone);
  }, []);

  useEffect(() => {
    if (!setupDone) return;
    getConfig("role").then((role) => {
      if (role === "master" || role === "slave") {
        startSyncConnections().catch(() => {
          // Sync-URL oder Peers ggf. noch nicht konfiguriert; ignorieren
        });
      }
    });
  }, [setupDone]);

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
    </SyncDataProvider>
  );
}

export default App;
