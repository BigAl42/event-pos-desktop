import { useState, useEffect, Suspense, lazy } from "react";
import { hasKasse, getConfig, startMasterServer, isMasterServerRunning, startSyncConnections } from "./db";
import { SyncDataProvider } from "./SyncDataContext";
import { SyncStatusProvider } from "./SyncStatusContext";
import HomePage from "./components/HomePage";
import InitialSetupDialog from "./components/InitialSetupDialog";
import CashRegisterView from "./components/CashRegisterView";
import SettlementView from "./components/SettlementView";
import SettingsView from "./components/SettingsView";
import MerchantAdminView from "./components/MerchantAdminView";
import SlaveMerchantOverview from "./components/SlaveMerchantOverview";
import MerchantBookingsDrilldown from "./components/MerchantBookingsDrilldown";
import MasterMerchantOverview from "./components/MasterMerchantOverview";
import JoinRequestsView from "./components/JoinRequestsView";
import VoidView from "./components/VoidView";
import SyncStatusView from "./components/SyncStatusView";
import StatusBar from "./components/StatusBar";

const HandbookView = lazy(() => import("./components/HandbookView"));

export type View =
  | "start"
  | "cash_register"
  | "settlement"
  | "void"
  | "sync_status"
  | "settings"
  | "handbook"
  | "merchant_admin"
  | "merchant_slave"
  | "merchant_drilldown"
  | "merchant_master_overview"
  | "merchant_master_drilldown"
  | "merchant_master_data"
  | "join_requests";

function App() {
  const [setupDone, setSetupDone] = useState<boolean | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [view, setView] = useState<View>("start");
  const [drilldownMerchant, setDrilldownMerchant] = useState<{ nummer: string; name: string } | null>(
    null
  );

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
        } catch {
          // Autostart is best-effort; user can start manually in Settings.
        }
      }

      try {
        const myWsUrl = await getConfig("my_ws_url");
        if (myWsUrl && myWsUrl.trim()) {
          await startSyncConnections();
        }
      } catch {
        // Sync URL or peers may not be configured yet
      }
    })();
  }, [setupDone]);

  if (setupError) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>Startup failed</h2>
        <p>The application could not be initialized.</p>
        <pre style={{ whiteSpace: "pre-wrap" }}>{setupError}</pre>
      </div>
    );
  }

  if (setupDone === null) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        Loading…
      </div>
    );
  }

  if (!setupDone) {
    return (
      <InitialSetupDialog
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
            <Suspense fallback={<div style={{ padding: "2rem", textAlign: "center" }}>Loading…</div>}>
            {view === "cash_register" && <CashRegisterView onBack={() => setView("start")} />}
            {view === "settlement" && <SettlementView onBack={() => setView("start")} />}
            {view === "void" && <VoidView onBack={() => setView("start")} />}
            {view === "sync_status" && (
              <SyncStatusView
                onBack={() => setView("start")}
                onOpenSettings={() => setView("settings")}
              />
            )}
            {view === "settings" && (
              <SettingsView
                onBack={() => setView("start")}
                onOpenHandbook={() => setView("handbook")}
              />
            )}
            {view === "merchant_admin" && <MerchantAdminView onBack={() => setView("start")} />}
            {view === "merchant_master_data" && (
              <MerchantAdminView onBack={() => setView("merchant_master_overview")} />
            )}
            {view === "merchant_master_overview" && (
              <MasterMerchantOverview
                onBack={() => setView("start")}
                onOpenDrilldown={(nummer, name) => {
                  setDrilldownMerchant({ nummer, name });
                  setView("merchant_master_drilldown");
                }}
                onOpenMasterData={() => setView("merchant_master_data")}
              />
            )}
            {view === "merchant_slave" && (
              <SlaveMerchantOverview
                onBack={() => setView("start")}
                onOpenDrilldown={(nummer, name) => {
                  setDrilldownMerchant({ nummer, name });
                  setView("merchant_drilldown");
                }}
              />
            )}
            {view === "merchant_drilldown" && drilldownMerchant && (
              <MerchantBookingsDrilldown
                haendlernummer={drilldownMerchant.nummer}
                haendlerName={drilldownMerchant.name}
                onClose={() => setView("merchant_slave")}
              />
            )}
            {view === "merchant_master_drilldown" && drilldownMerchant && (
              <MerchantBookingsDrilldown
                haendlernummer={drilldownMerchant.nummer}
                haendlerName={drilldownMerchant.name}
                onClose={() => setView("merchant_master_overview")}
              />
            )}
            {view === "join_requests" && <JoinRequestsView onBack={() => setView("start")} />}
            {view === "handbook" && <HandbookView onBack={() => setView("start")} />}
            {view === "start" && (
              <HomePage
                onOpenCashRegister={() => setView("cash_register")}
                onOpenSettlement={() => setView("settlement")}
                onOpenVoid={() => setView("void")}
                onOpenSyncStatus={() => setView("sync_status")}
                onOpenSettings={() => setView("settings")}
                onOpenHandbook={() => setView("handbook")}
                onOpenMerchantAdmin={() => setView("merchant_admin")}
                onOpenMerchantMasterOverview={() => setView("merchant_master_overview")}
                onOpenMerchantSlaveOverview={() => setView("merchant_slave")}
                onOpenJoinRequests={() => setView("join_requests")}
              />
            )}
            </Suspense>
          </main>
          <StatusBar
            onOpenJoinRequests={() => setView("join_requests")}
            onOpenHandbook={() => setView("handbook")}
          />
        </div>
      </SyncStatusProvider>
    </SyncDataProvider>
  );
}

export default App;
