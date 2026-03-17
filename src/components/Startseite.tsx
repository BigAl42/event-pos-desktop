import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useSyncData } from "../SyncDataContext";
import {
  getConfig,
  getSyncStatus,
  getJoinRequests,
  removePeerFromNetwork,
  discoverMasters,
  setConfig,
  joinNetwork,
  startSyncConnections,
  type SyncStatusEntry,
  type DiscoveredMaster,
} from "../db";
import "./Startseite.css";

const DEFAULT_SYNC_PORT = 8766;

function formatZeit(iso: string | null): { text: string; isStale: boolean } {
  if (!iso) return { text: "Noch kein Sync erfolgt", isStale: true };
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const isStale = diffMs > 5 * 60 * 1000;
    return {
      text: d.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      }),
      isStale,
    };
  } catch {
    return { text: iso, isStale: false };
  }
}

type Props = {
  onOpenKasse: () => void;
  onOpenAbrechnung: () => void;
  onOpenStorno?: () => void;
  onOpenSyncStatus?: () => void;
  onOpenEinstellungen: () => void;
  onOpenHaendler?: () => void;
  onOpenHaendlerMaster?: () => void;
  onOpenHaendlerSlave?: () => void;
  onOpenJoinAnfragen?: () => void;
};

export default function Startseite({
  onOpenKasse,
  onOpenAbrechnung,
  onOpenStorno,
  onOpenSyncStatus,
  onOpenEinstellungen,
  onOpenHaendler,
  onOpenHaendlerMaster,
  onOpenHaendlerSlave,
  onOpenJoinAnfragen,
}: Props) {
  const [role, setRole] = useState<string | null>(null);
  const [syncEntries, setSyncEntries] = useState<SyncStatusEntry[]>([]);
  const [slaveConsiderConnected, setSlaveConsiderConnected] = useState(false);
  const [slaveDisconnectTimerActive, setSlaveDisconnectTimerActive] = useState(false);
  const [discoveredMasters, setDiscoveredMasters] = useState<DiscoveredMaster[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [joinDialogMaster, setJoinDialogMaster] = useState<DiscoveredMaster | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinMyWsUrl, setJoinMyWsUrl] = useState(`ws://127.0.0.1:${DEFAULT_SYNC_PORT}`);
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinMessage, setJoinMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingJoinCount, setPendingJoinCount] = useState(0);
  const [removingPeerId, setRemovingPeerId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [confirmPeerId, setConfirmPeerId] = useState<string | null>(null);

  const isMaster = role === "master";
  const syncSummary =
    syncEntries.length === 0
      ? null
      : { total: syncEntries.length, connected: syncEntries.filter((e) => e.connected).length };

  const slaveConnected =
    role === "slave" &&
    (syncSummary !== null && syncSummary.connected > 0 ? true : slaveConsiderConnected);

  useEffect(() => {
    if (role !== "slave") {
      setSlaveConsiderConnected(false);
      setSlaveDisconnectTimerActive(false);
      return;
    }
    if (syncSummary !== null && syncSummary.connected > 0) {
      setSlaveConsiderConnected(true);
      setSlaveDisconnectTimerActive(false);
      return;
    }
    if (!slaveConsiderConnected || slaveDisconnectTimerActive) return;
    setSlaveDisconnectTimerActive(true);
    const t = setTimeout(() => {
      setSlaveConsiderConnected(false);
      setSlaveDisconnectTimerActive(false);
    }, 8000);
    return () => clearTimeout(t);
  }, [role, syncSummary, slaveConsiderConnected, slaveDisconnectTimerActive]);

  useEffect(() => {
    getConfig("role").then(setRole);
  }, []);

  useEffect(() => {
    if (role !== "slave") return;
    if (slaveConnected) return;
    setDiscoveryLoading(true);
    const t = setTimeout(() => {
      discoverMasters()
        .then(setDiscoveredMasters)
        .catch(() => setDiscoveredMasters([]))
        .finally(() => setDiscoveryLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [role, slaveConnected]);

  useEffect(() => {
    if (role !== "master" || !onOpenJoinAnfragen) return;
    function loadPending() {
      getJoinRequests()
        .then((list) => setPendingJoinCount(list.length))
        .catch(() => setPendingJoinCount(0));
    }
    loadPending();
    const id = setInterval(loadPending, 3500);
    const unlisten = listen("join-request-pending", loadPending);
    return () => {
      clearInterval(id);
      unlisten.then((fn) => fn());
    };
  }, [role, onOpenJoinAnfragen]);

  useEffect(() => {
    if (!joinDialogMaster) return;
    getConfig("my_ws_url").then((v) => setJoinMyWsUrl(v ?? `ws://127.0.0.1:${DEFAULT_SYNC_PORT}`));
    setJoinCode("");
    setJoinMessage(null);
  }, [joinDialogMaster]);

  function normalizeJoinCode(input: string): string {
    return input.replace(/\D/g, "");
  }

  async function handleStartseiteJoin() {
    if (!joinDialogMaster) return;
    const normalized = normalizeJoinCode(joinCode);
    if (normalized.length !== 6) {
      setJoinMessage({ ok: false, text: "Bitte 6-stelligen Code eingeben (z.B. 123 456)." });
      return;
    }
    if (!joinMyWsUrl.trim()) {
      setJoinMessage({ ok: false, text: "Bitte eigene Sync-URL eintragen." });
      return;
    }
    setJoinLoading(true);
    setJoinMessage(null);
    try {
      await setConfig("master_ws_url", joinDialogMaster.ws_url);
      await setConfig("my_ws_url", joinMyWsUrl.trim());
      const msg = await joinNetwork(normalized);
      setJoinMessage({ ok: true, text: msg });
      try {
        await startSyncConnections();
      } catch {
        // optional
      }
      setJoinDialogMaster(null);
    } catch (e) {
      setJoinMessage({ ok: false, text: String(e) });
    } finally {
      setJoinLoading(false);
    }
  }

  useEffect(() => {
    function load() {
      getSyncStatus()
        .then(setSyncEntries)
        .then(() => setSyncError(null))
        .catch((e) => {
          setSyncError(String(e));
          setSyncEntries([]);
        });
    }
    load();
    const id = setInterval(load, 3500);
    return () => clearInterval(id);
  }, []);

  async function handleRemovePeerFromNetwork(peerId: string) {
    // #region agent log
    fetch("http://127.0.0.1:7475/ingest/339f8301-dff1-46a5-b3e4-2b85e31fc48f", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "06ad72",
      },
      body: JSON.stringify({
        sessionId: "06ad72",
        runId: "initial",
        hypothesisId: "H1",
        location: "Startseite.tsx:handleRemovePeerFromNetwork:entry",
        message: "handleRemovePeerFromNetwork entry",
        data: { peerId },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion agent log

    setRemovingPeerId(peerId);
    try {
      // #region agent log
      fetch("http://127.0.0.1:7475/ingest/339f8301-dff1-46a5-b3e4-2b85e31fc48f", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "06ad72",
        },
        body: JSON.stringify({
          sessionId: "06ad72",
          runId: "initial",
          hypothesisId: "H2",
          location: "Startseite.tsx:handleRemovePeerFromNetwork:beforeRemove",
          message: "About to call removePeerFromNetwork from Startseite",
          data: { peerId },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion agent log

      await removePeerFromNetwork(peerId);
      getSyncStatus().then(setSyncEntries);
    } finally {
      setRemovingPeerId(null);
    }
  }

  return (
    <div className="startseite">
      <header className="startseite-header">
        <h1>Kassensystem</h1>
        {role === "master" && (
          <span className="startseite-role startseite-role-master">Hauptkasse</span>
        )}
        {role === "slave" && (
          <span className="startseite-role startseite-role-slave">Nebenkasse</span>
        )}
        {syncError && (
          <p className="startseite-connection startseite-connection-warn">
            {syncError.includes("Eigene Sync-URL nicht konfiguriert") ||
            syncError.includes("Hauptkassen-URL nicht konfiguriert")
              ? "Sync noch nicht vollständig eingerichtet – bitte Einstellungen prüfen."
              : "Sync-Status aktuell nicht abrufbar. Bitte Einstellungen prüfen oder Anwendung neu starten."}
          </p>
        )}
        {!syncError && syncSummary !== null && (
          <p
            className={
              syncSummary.connected > 0
                ? "startseite-connection startseite-connection-ok"
                : "startseite-connection startseite-connection-warn"
            }
          >
            {syncSummary.connected > 0
              ? `Verbunden mit ${syncSummary.connected} von ${syncSummary.total} Kassen`
              : `Nicht verbunden (0 von ${syncSummary.total} Kassen)`}
          </p>
        )}
      </header>

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
                  <span
                    className={
                      formatZeit(e.last_sync).isStale
                        ? "startseite-kassenliste-time startseite-kassenliste-time-stale"
                        : "startseite-kassenliste-time"
                    }
                  >
                    Letzter Sync: {formatZeit(e.last_sync).text}
                  </span>
                  <button
                    type="button"
                    className="startseite-kassenliste-entkoppeln"
                    onClick={() => setConfirmPeerId(e.peer_id)}
                    disabled={removingPeerId !== null || confirmPeerId !== null}
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

      {role === "slave" && (
        <section
          className={
            slaveConnected
              ? "startseite-join-section startseite-join-section-connected"
              : "startseite-join-section"
          }
        >
          <h2 className="startseite-join-title">Mit Hauptkasse verbinden</h2>
          {!slaveConnected && syncSummary !== null && syncSummary.total > 0 && (
            <p className="startseite-join-disconnect-hint">
              Verbindung zur Hauptkasse wurde getrennt – bitte erneut verbinden.
            </p>
          )}
          {slaveConnected ? (
            <>
              <p className="startseite-join-connected">Mit Hauptkasse verbunden.</p>
              <p className="startseite-join-hint">
                <button
                  type="button"
                  className="startseite-join-settings-link"
                  onClick={onOpenEinstellungen}
                >
                  In Einstellungen Hauptkasse erneut suchen
                </button>
              </p>
            </>
          ) : (
            <>
              {discoveryLoading ? (
                <p className="startseite-join-hint">Suche Hauptkasse…</p>
              ) : discoveredMasters.length > 0 ? (
                <ul className="startseite-join-list">
                  {discoveredMasters.map((m) => (
                    <li key={m.ws_url} className="startseite-join-item">
                      <span className="startseite-join-name">{m.name}</span>
                      <span className="startseite-join-url">{m.ws_url}</span>
                      <button
                        type="button"
                        className="startseite-join-btn"
                        onClick={() => setJoinDialogMaster(m)}
                      >
                        Beitreten
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="startseite-join-hint">
                  Keine Hauptkasse gefunden. In Einstellungen URL eintragen oder später erneut suchen.
                </p>
              )}
            </>
          )}
        </section>
      )}

      <div className="tiles">
        <button type="button" className="tile tile-kasse" onClick={onOpenKasse}>
          <span className="tile-title">Kasse</span>
          <span className="tile-desc">Kundenabrechnung erfassen</span>
        </button>
        <button type="button" className="tile tile-abrechnung" onClick={onOpenAbrechnung}>
          <span className="tile-title">Abrechnung</span>
          <span className="tile-desc">Händler-Summen anzeigen</span>
        </button>
        {onOpenStorno && (
          <button type="button" className="tile tile-storno" onClick={onOpenStorno}>
            <span className="tile-title">Storno</span>
            <span className="tile-desc">Position oder Beleg stornieren</span>
          </button>
        )}
        {onOpenSyncStatus && (
          <button type="button" className="tile tile-sync-status" onClick={onOpenSyncStatus}>
            <span className="tile-title">Sync-Status</span>
            <span className="tile-desc">Verbindung zu Peers</span>
          </button>
        )}
        {isMaster && onOpenHaendler && (
          <button type="button" className="tile tile-haendler" onClick={onOpenHaendler}>
            <span className="tile-title">Händlerverwaltung</span>
            <span className="tile-desc">Stammdaten Händlernummern</span>
          </button>
        )}
        {isMaster && onOpenHaendlerMaster && (
          <button
            type="button"
            className="tile tile-haendler"
            onClick={onOpenHaendlerMaster}
          >
            <span className="tile-title">Händlerübersicht</span>
            <span className="tile-desc">Umsätze &amp; Buchungen (Hauptkasse)</span>
          </button>
        )}
        {role === "slave" && onOpenHaendlerSlave && (
          <button type="button" className="tile tile-haendler" onClick={onOpenHaendlerSlave}>
            <span className="tile-title">Händlerübersicht</span>
            <span className="tile-desc">Umsätze &amp; Buchungen (read-only)</span>
          </button>
        )}
        {isMaster && onOpenJoinAnfragen && (
          <button type="button" className="tile tile-join" onClick={onOpenJoinAnfragen}>
            <span className="tile-title">
              Join-Anfragen
              {pendingJoinCount > 0 && (
                <span className="tile-badge" aria-hidden="true">
                  {pendingJoinCount}
                </span>
              )}
            </span>
            <span className="tile-desc">Anmeldungen annehmen/ablehnen</span>
          </button>
        )}
        <button type="button" className="tile tile-einstellungen" onClick={onOpenEinstellungen}>
          <span className="tile-title">Einstellungen</span>
          <span className="tile-desc">Kasse & Netzwerk</span>
        </button>
      </div>

      {confirmPeerId && (
        <div className="startseite-confirm-overlay">
          <div className="startseite-confirm-dialog">
            <p>
              Sind Sie sicher, dass Sie die Verbindung zu dieser Kasse trennen möchten?
            </p>
            <div className="startseite-confirm-actions">
              <button
                type="button"
                onClick={() => {
                  setConfirmPeerId(null);
                }}
                disabled={removingPeerId !== null}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="startseite-confirm-danger"
                onClick={async () => {
                  const peerId = confirmPeerId;
                  setConfirmPeerId(null);
                  if (peerId) {
                    await handleRemovePeerFromNetwork(peerId);
                  }
                }}
                disabled={removingPeerId !== null}
              >
                Verbindung trennen
              </button>
            </div>
          </div>
        </div>
      )}

      {joinDialogMaster && (
        <div className="startseite-join-dialog-overlay" onClick={() => setJoinDialogMaster(null)}>
          <div className="startseite-join-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="startseite-join-dialog-title">
              Beitreten: {joinDialogMaster.name}
            </h3>
            <label className="startseite-join-dialog-label">
              Join-Code (6 Ziffern, z.B. 123 456)
              <input
                type="text"
                inputMode="numeric"
                value={joinCode}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "");
                  if (digits.length <= 6) setJoinCode(digits);
                }}
                onBlur={() => {
                  const d = joinCode.replace(/\D/g, "");
                  if (d.length <= 3) setJoinCode(d);
                  else if (d.length <= 6) setJoinCode(`${d.slice(0, 3)} ${d.slice(3)}`);
                }}
                placeholder="000 000"
                disabled={joinLoading}
              />
            </label>
            <label className="startseite-join-dialog-label">
              Eigene Sync-URL (z.B. ws://127.0.0.1:8766)
              <input
                type="text"
                value={joinMyWsUrl}
                onChange={(e) => setJoinMyWsUrl(e.target.value)}
                placeholder={`ws://127.0.0.1:${DEFAULT_SYNC_PORT}`}
                disabled={joinLoading}
              />
            </label>
            {joinMessage && (
              <p className={joinMessage.ok ? "startseite-join-dialog-ok" : "startseite-join-dialog-error"}>
                {joinMessage.text}
              </p>
            )}
            <div className="startseite-join-dialog-actions">
              <button type="button" onClick={() => setJoinDialogMaster(null)} disabled={joinLoading}>
                Abbrechen
              </button>
              <button
                type="button"
                className="startseite-join-dialog-submit"
                onClick={handleStartseiteJoin}
                disabled={joinLoading}
              >
                {joinLoading ? "Beitreten…" : "Beitreten"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
