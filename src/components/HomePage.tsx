import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import {
  getConfig,
  getAbrechnungsläufe,
  getJoinRequests,
  removePeerFromNetwork,
  discoverMasters,
  setConfig,
  joinNetwork,
  startSyncConnections,
  type DiscoveredMaster,
} from "../db";
import { intlLocaleFor } from "../i18n";
import { useSyncStatus } from "../SyncStatusContext";
import { translateUserJsonMessage } from "../userMessage";
import type { TFunction } from "i18next";
import "./HomePage.css";

const DEFAULT_SYNC_PORT = 8766;

function formatLastSync(iso: string | null, locale: string, t: TFunction): { text: string; isStale: boolean } {
  if (!iso) return { text: t("home.neverSynced"), isStale: true };
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const isStale = diffMs > 5 * 60 * 1000;
    return {
      text: d.toLocaleString(locale, {
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
  onOpenCashRegister: () => void;
  onOpenSettlement: () => void;
  onOpenVoid?: () => void;
  onOpenSyncStatus?: () => void;
  onOpenSettings: () => void;
  onOpenHandbook?: () => void;
  onOpenMerchantAdmin?: () => void;
  onOpenMerchantMasterOverview?: () => void;
  onOpenMerchantSlaveOverview?: () => void;
  onOpenJoinRequests?: () => void;
};

export default function HomePage({
  onOpenCashRegister,
  onOpenSettlement,
  onOpenVoid,
  onOpenSyncStatus,
  onOpenSettings,
  onOpenHandbook,
  onOpenMerchantAdmin,
  onOpenMerchantMasterOverview,
  onOpenMerchantSlaveOverview,
  onOpenJoinRequests,
}: Props) {
  const { t, i18n } = useTranslation();
  const intlLocale = intlLocaleFor(i18n.language);
  const formatSyncTime = useCallback(
    (iso: string | null) => formatLastSync(iso, intlLocale, t),
    [intlLocale, t],
  );

  const [role, setRole] = useState<string | null>(null);
  const { entries: syncEntries, isConnected: slaveConnected, syncError, notConfigured, refresh } =
    useSyncStatus();
  const [activeLaufId, setActiveLaufId] = useState<string | null>(null);
  const [activeLaufName, setActiveLaufName] = useState<string | null>(null);
  const [closeoutOkFor, setCloseoutOkFor] = useState<string | null>(null);
  const [closeoutOkAt, setCloseoutOkAt] = useState<string | null>(null);
  const [discoveredMasters, setDiscoveredMasters] = useState<DiscoveredMaster[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [joinDialogMaster, setJoinDialogMaster] = useState<DiscoveredMaster | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinMyWsUrl, setJoinMyWsUrl] = useState(`wss://127.0.0.1:${DEFAULT_SYNC_PORT}`);
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinMessage, setJoinMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingJoinCount, setPendingJoinCount] = useState(0);
  const [removingPeerId, setRemovingPeerId] = useState<string | null>(null);
  const [confirmPeerId, setConfirmPeerId] = useState<string | null>(null);

  const isMaster = role === "master";

  useEffect(() => {
    getConfig("role").then(setRole);
  }, []);

  useEffect(() => {
    if (role !== "slave") {
      setActiveLaufId(null);
      setActiveLaufName(null);
      setCloseoutOkFor(null);
      setCloseoutOkAt(null);
      return;
    }
    getAbrechnungsläufe()
      .then((läufe) => {
        const aktiver = läufe.find((l) => l.is_aktiv);
        setActiveLaufId(aktiver ? aktiver.id : null);
        setActiveLaufName(aktiver ? aktiver.name : null);
      })
      .catch(() => {
        setActiveLaufId(null);
        setActiveLaufName(null);
      });
    getConfig("closeout_ok_for_lauf_id").then((v) => setCloseoutOkFor(v ?? null)).catch(() => setCloseoutOkFor(null));
    getConfig("closeout_ok_at").then((v) => setCloseoutOkAt(v ?? null)).catch(() => setCloseoutOkAt(null));
  }, [role]);

  useEffect(() => {
    if (role !== "slave") return;
    if (slaveConnected) return;
    setDiscoveryLoading(true);
    const timer = setTimeout(() => {
      discoverMasters()
        .then(setDiscoveredMasters)
        .catch(() => setDiscoveredMasters([]))
        .finally(() => setDiscoveryLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [role, slaveConnected]);

  useEffect(() => {
    if (role !== "master" || !onOpenJoinRequests) return;
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
  }, [role, onOpenJoinRequests]);

  useEffect(() => {
    if (!joinDialogMaster) return;
    getConfig("my_ws_url").then((v) => setJoinMyWsUrl(v ?? `wss://127.0.0.1:${DEFAULT_SYNC_PORT}`));
    setJoinCode("");
    setJoinMessage(null);
  }, [joinDialogMaster]);

  function normalizeJoinCode(input: string): string {
    return input.replace(/\D/g, "");
  }

  async function handleHomePageJoin() {
    if (!joinDialogMaster) return;
    const normalized = normalizeJoinCode(joinCode);
    if (normalized.length !== 6) {
      setJoinMessage({ ok: false, text: t("home.joinCodeInvalid") });
      return;
    }
    if (!joinMyWsUrl.trim()) {
      setJoinMessage({ ok: false, text: t("home.joinUrlRequired") });
      return;
    }
    setJoinLoading(true);
    setJoinMessage(null);
    try {
      await setConfig("master_ws_url", joinDialogMaster.ws_url);
      await setConfig("my_ws_url", joinMyWsUrl.trim());
      const msg = await joinNetwork(normalized);
      setJoinMessage({ ok: true, text: translateUserJsonMessage(msg) });
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

  async function handleRemovePeerFromNetwork(peerId: string) {
    setRemovingPeerId(peerId);
    try {
      await removePeerFromNetwork(peerId);
      refresh();
    } finally {
      setRemovingPeerId(null);
    }
  }

  return (
    <div className="home-page" data-testid="home-page-root">
      <header className="home-page-header">
        <h1>{t("home.title")}</h1>
        {role === "master" && (
          <span className="home-page-role home-page-role-master">{t("home.roleMain")}</span>
        )}
        {role === "slave" && (
          <span className="home-page-role home-page-role-slave">{t("home.roleSlave")}</span>
        )}
        {syncError && (
          <p className="home-page-connection home-page-connection-warn">
            {notConfigured ? t("syncStatus.notConfigured") : t("home.syncFetchError")}
          </p>
        )}
      </header>

      {role === "master" && (
        <section className="home-page-kassenliste">
          <h2 className="home-page-kassenliste-title">{t("home.registersTitle")}</h2>
          {syncEntries.length === 0 ? (
            <p className="home-page-kassenliste-leer">{t("home.registersEmpty")}</p>
          ) : (
            <ul className="home-page-kassenliste-list">
              {syncEntries.map((e) => (
                <li key={e.peer_id} className="home-page-kassenliste-item">
                  <span className="home-page-kassenliste-name">{e.name || e.peer_id}</span>
                  <span
                    className={`home-page-kassenliste-badge ${e.connected ? "home-page-kassenliste-badge-ok" : "home-page-kassenliste-badge-warn"}`}
                  >
                    {e.connected ? t("home.connected") : t("home.disconnected")}
                  </span>
                  <span
                    className={
                      formatSyncTime(e.last_sync).isStale
                        ? "home-page-kassenliste-time home-page-kassenliste-time-stale"
                        : "home-page-kassenliste-time"
                    }
                  >
                    {t("home.lastSync")} {formatSyncTime(e.last_sync).text}
                  </span>
                  <button
                    type="button"
                    className="home-page-kassenliste-entkoppeln"
                    onClick={() => setConfirmPeerId(e.peer_id)}
                    disabled={removingPeerId !== null || confirmPeerId !== null}
                    title={t("home.detachRegister")}
                  >
                    {removingPeerId === e.peer_id ? t("common.ellipsis") : t("home.detach")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {role === "slave" && (!slaveConnected || !!syncError) && (
        <section
          className={
            slaveConnected
              ? "home-page-join-section home-page-join-section-connected"
              : "home-page-join-section"
          }
        >
          <h2 className="home-page-join-title">{t("home.joinMainTitle")}</h2>
          {slaveConnected ? (
            <>
              <p className="home-page-join-connected">{t("home.joinConnected")}</p>
              <p className="home-page-join-hint">
                <button
                  type="button"
                  className="home-page-join-settings-link"
                  onClick={onOpenSettings}
                >
                  {t("home.joinSearchAgain")}
                </button>
              </p>
            </>
          ) : (
            <>
              {discoveryLoading ? (
                <p className="home-page-join-hint">{t("home.joinSearching")}</p>
              ) : discoveredMasters.length > 0 ? (
                <ul className="home-page-join-list">
                  {discoveredMasters.map((m) => (
                    <li key={m.ws_url} className="home-page-join-item">
                      <span className="home-page-join-name">{m.name}</span>
                      <span className="home-page-join-url">{m.ws_url}</span>
                      <button
                        type="button"
                        className="home-page-join-btn"
                        onClick={() => setJoinDialogMaster(m)}
                      >
                        {t("home.joinJoin")}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="home-page-join-hint">{t("home.joinNoMaster")}</p>
              )}
            </>
          )}
        </section>
      )}

      {role === "slave" && (
        <section className="home-page-closeout-section">
          <h2 className="home-page-closeout-title">{t("home.closeoutTitle")}</h2>
          <p className="home-page-closeout-hint">{t("home.closeoutHint")}</p>
          <p className="home-page-closeout-status">
            {t("home.activeCycle")} <strong>{activeLaufName ?? t("common.dash")}</strong>
            {" · "}
            {t("home.closeoutLabel")}{" "}
            {closeoutOkAt ? (
              <strong>
                {t("home.closeoutOkSince", {
                  time: new Date(closeoutOkAt).toLocaleString(intlLocale),
                })}
                {activeLaufId && closeoutOkFor === activeLaufId ? "" : t("home.closeoutWrongCycle")}
              </strong>
            ) : (
              <strong>{t("home.closeoutNotRequested")}</strong>
            )}
          </p>
          <button type="button" className="home-page-closeout-btn" onClick={onOpenSettings}>
            {t("home.closeoutOpenSettings")}
          </button>
        </section>
      )}

      <div className="tiles">
        <button type="button" className="tile tile-kasse" onClick={onOpenCashRegister}>
          <span className="tile-title">{t("home.tileCashRegister")}</span>
          <span className="tile-desc">{t("home.tileCashRegisterDesc")}</span>
        </button>
        <button type="button" className="tile tile-abrechnung" onClick={onOpenSettlement}>
          <span className="tile-title">{t("home.tileSettlement")}</span>
          <span className="tile-desc">{t("home.tileSettlementDesc")}</span>
        </button>
        {onOpenVoid && (
          <button type="button" className="tile tile-storno" onClick={onOpenVoid}>
            <span className="tile-title">{t("home.tileVoid")}</span>
            <span className="tile-desc">{t("home.tileVoidDesc")}</span>
          </button>
        )}
        {onOpenSyncStatus && (
          <button type="button" className="tile tile-sync-status" onClick={onOpenSyncStatus}>
            <span className="tile-title">{t("home.tileSyncStatus")}</span>
            <span className="tile-desc">{t("home.tileSyncStatusDesc")}</span>
          </button>
        )}
        {isMaster && onOpenMerchantAdmin && (
          <button type="button" className="tile tile-haendler" onClick={onOpenMerchantAdmin}>
            <span className="tile-title">{t("home.tileMerchantAdmin")}</span>
            <span className="tile-desc">{t("home.tileMerchantAdminDesc")}</span>
          </button>
        )}
        {isMaster && onOpenMerchantMasterOverview && (
          <button
            type="button"
            className="tile tile-haendler"
            onClick={onOpenMerchantMasterOverview}
          >
            <span className="tile-title">{t("home.tileMerchantOverviewMaster")}</span>
            <span className="tile-desc">{t("home.tileMerchantOverviewMasterDesc")}</span>
          </button>
        )}
        {role === "slave" && onOpenMerchantSlaveOverview && (
          <button type="button" className="tile tile-haendler" onClick={onOpenMerchantSlaveOverview}>
            <span className="tile-title">{t("home.tileMerchantOverviewSlave")}</span>
            <span className="tile-desc">{t("home.tileMerchantOverviewSlaveDesc")}</span>
          </button>
        )}
        {isMaster && onOpenJoinRequests && (
          <button type="button" className="tile tile-join" onClick={onOpenJoinRequests}>
            <span className="tile-title">
              {t("home.tileJoinRequests")}
              {pendingJoinCount > 0 && (
                <span className="tile-badge" aria-hidden="true">
                  {pendingJoinCount}
                </span>
              )}
            </span>
            <span className="tile-desc">{t("home.tileJoinRequestsDesc")}</span>
          </button>
        )}
        {onOpenHandbook && (
          <button type="button" className="tile tile-handbook" onClick={onOpenHandbook}>
            <span className="tile-title">{t("home.tileHandbook")}</span>
            <span className="tile-desc">{t("home.tileHandbookDesc")}</span>
          </button>
        )}
        <button type="button" className="tile tile-einstellungen" onClick={onOpenSettings}>
          <span className="tile-title">{t("home.tileSettings")}</span>
          <span className="tile-desc">{t("home.tileSettingsDesc")}</span>
        </button>
      </div>

      {confirmPeerId && (
        <div className="home-page-confirm-overlay">
          <div className="home-page-confirm-dialog">
            <p>{t("home.detachConfirm")}</p>
            <div className="home-page-confirm-actions">
              <button
                type="button"
                onClick={() => {
                  setConfirmPeerId(null);
                }}
                disabled={removingPeerId !== null}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="home-page-confirm-danger"
                onClick={async () => {
                  const peerId = confirmPeerId;
                  setConfirmPeerId(null);
                  if (peerId) {
                    await handleRemovePeerFromNetwork(peerId);
                  }
                }}
                disabled={removingPeerId !== null}
              >
                {t("home.disconnect")}
              </button>
            </div>
          </div>
        </div>
      )}

      {joinDialogMaster && (
        <div className="home-page-join-dialog-overlay" onClick={() => setJoinDialogMaster(null)}>
          <div className="home-page-join-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="home-page-join-dialog-title">
              {t("home.joinDialogTitle", { name: joinDialogMaster.name })}
            </h3>
            <label className="home-page-join-dialog-label">
              {t("home.joinCodeLabel")}
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
            <label className="home-page-join-dialog-label">
              {t("home.joinMyUrlLabel")}
              <input
                type="text"
                value={joinMyWsUrl}
                onChange={(e) => setJoinMyWsUrl(e.target.value)}
                placeholder={`wss://127.0.0.1:${DEFAULT_SYNC_PORT}`}
                disabled={joinLoading}
              />
            </label>
            {joinMessage && (
              <p className={joinMessage.ok ? "home-page-join-dialog-ok" : "home-page-join-dialog-error"}>
                {joinMessage.text}
              </p>
            )}
            <div className="home-page-join-dialog-actions">
              <button type="button" onClick={() => setJoinDialogMaster(null)} disabled={joinLoading}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="home-page-join-dialog-submit"
                onClick={handleHomePageJoin}
                disabled={joinLoading}
              >
                {joinLoading ? t("home.joinSubmitting") : t("home.joinSubmit")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
