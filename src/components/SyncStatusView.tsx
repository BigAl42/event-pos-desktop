import { useMemo, useState, useEffect } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  discoverMasters,
  getConfig,
  getAbrechnungsläufe,
  getSyncRuntimeStatus,
  removePeerFromNetwork,
  type DiscoveredMaster,
  type SyncRuntimeStatus,
} from "../db";
import { useSyncStatus } from "../SyncStatusContext";
import "./SyncStatusView.css";

type Props = { onBack: () => void; onOpenEinstellungen?: () => void };

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

export default function SyncStatusView({ onBack, onOpenEinstellungen }: Props) {
  const { entries, refresh, lastRefreshAt, pollMs } = useSyncStatus();
  const [role, setRole] = useState<string | null>(null);
  const [activeLaufId, setActiveLaufId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<SyncRuntimeStatus | null>(null);
  const [discoveredMasters, setDiscoveredMasters] = useState<DiscoveredMaster[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [discoveryDone, setDiscoveryDone] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  function loadRuntime() {
    getSyncRuntimeStatus()
      .then(setRuntime)
      .catch(() => setRuntime(null));
  }

  async function handleDiscover() {
    setDiscoveryLoading(true);
    setDiscoveryError(null);
    setDiscoveryDone(false);
    try {
      const list = await discoverMasters();
      setDiscoveredMasters(list);
    } catch (e) {
      setDiscoveredMasters([]);
      setDiscoveryError(String(e));
    } finally {
      setDiscoveryLoading(false);
      setDiscoveryDone(true);
    }
  }

  useEffect(() => {
    getConfig("role").then(setRole);
  }, []);

  useEffect(() => {
    if (role !== "master") {
      setActiveLaufId(null);
      return;
    }
    getAbrechnungsläufe()
      .then((läufe) => {
        const aktiver = läufe.find((l) => l.is_aktiv);
        setActiveLaufId(aktiver ? aktiver.id : null);
      })
      .catch(() => setActiveLaufId(null));
  }, [role]);

  useEffect(() => {
    refresh();
    loadRuntime();
    const id2 = setInterval(loadRuntime, 3000);
    return () => {
      clearInterval(id2);
    };
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  const retry = useMemo(() => {
    if (lastRefreshAt == null) return { remainingMs: pollMs, progress01: 0 };
    const elapsed = Math.max(0, now - lastRefreshAt);
    const remainingMs = pollMs - (elapsed % pollMs);
    const progress01 = 1 - remainingMs / pollMs;
    return { remainingMs, progress01 };
  }, [lastRefreshAt, pollMs, now]);

  async function handleEntkoppeln(peerId: string) {
    const confirmed = await confirm("Sind Sie sicher, dass Sie die Verbindung zu dieser Kasse trennen möchten?", {
      title: "Kasse entkoppeln",
      kind: "warning",
      okLabel: "Entkoppeln",
      cancelLabel: "Abbrechen",
    });
    if (!confirmed) {
      return;
    }
    setError("");
    setRemovingId(peerId);
    try {
      await removePeerFromNetwork(peerId);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="sync-status-view">
      <header className="sync-status-header">
        <button type="button" onClick={onBack}>
          ← Zurück
        </button>
        <h1>Sync-Status</h1>
      </header>

      <section className="sync-status-section">
        <div className="sync-status-section-header">
          <h2>Sync Runtime</h2>
        </div>
        {runtime ? (
          <p>
            Sync gestartet: <strong>{runtime.started ? "Ja" : "Nein"}</strong>
            {" · "}
            Verbundene Peers: <strong>{runtime.connected_peers}</strong>
            {runtime.started_at ? (
              <>
                {" · "}
                Startzeit: <strong>{new Date(runtime.started_at).toLocaleString("de-DE")}</strong>
              </>
            ) : null}
          </p>
        ) : (
          <p className="sync-status-leer">Sync-Runtime-Status nicht verfügbar.</p>
        )}
      </section>

      <section className="sync-status-section">
        <div className="sync-status-section-header">
          <h2>Hauptkassen im LAN (mDNS)</h2>
          <button type="button" onClick={handleDiscover} disabled={discoveryLoading}>
            {discoveryLoading ? "Suche…" : "Suchen"}
          </button>
        </div>
        {discoveryError && <p className="sync-status-error">{discoveryError}</p>}
        {discoveredMasters.length === 0 ? (
          <p className="sync-status-leer">
            {discoveryDone ? "Keine Hauptkasse gefunden." : "Noch nicht gesucht."}
          </p>
        ) : (
          <ul className="sync-status-discovery-list">
            {discoveredMasters.map((m) => (
              <li key={m.ws_url} className="sync-status-discovery-item">
                <span className="sync-status-name">{m.name}</span>
                <span className="sync-status-url">{m.ws_url}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <div className="sync-status-error">
          <p>{error}</p>
          {onOpenEinstellungen && (
            <button type="button" onClick={onOpenEinstellungen}>
              Einstellungen öffnen
            </button>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="sync-status-leer">
          Keine Peers konfiguriert. In Einstellungen Sync starten (Hauptkasse: „Sync zu Peers starten“, Nebenkasse: „Sync starten“).
        </p>
      ) : (
        <section className="sync-status-section">
          <div className="sync-status-section-header">
            <h2>Sync-Peers (kontakt / Sync)</h2>
          </div>
          <ul className="sync-status-list">
            {entries.map((e) => (
              <li key={e.peer_id} className="sync-status-item">
                <span className="sync-status-name">{e.name || e.peer_id}</span>
                <span className="sync-status-badge-wrap">
                  <span className={`sync-status-badge ${e.connected ? "connected" : "disconnected"}`}>
                    {e.connected ? "Verbunden" : "Getrennt"}
                  </span>
                  {role === "master" && e.closeout_ok_at && (
                    (activeLaufId && e.closeout_ok_for_lauf_id === activeLaufId) ? (
                      <span
                        className="sync-status-badge connected"
                        title={`Closeout OK für aktiven Lauf seit ${new Date(e.closeout_ok_at).toLocaleString("de-DE")}`}
                      >
                        Closeout OK
                      </span>
                    ) : (
                      <span
                        className="sync-status-badge disconnected"
                        title={`Closeout ist vorhanden, aber nicht für den aktiven Lauf. (ok_for=${e.closeout_ok_for_lauf_id ?? "—"})`}
                      >
                        Closeout alt
                      </span>
                    )
                  )}
                  {!e.connected && (
                    <span
                      className="sync-status-retry-ring"
                      aria-label={`Nächster Kontaktversuch in ${Math.ceil(retry.remainingMs / 1000)}s`}
                      title={`Nächster Kontaktversuch in ~${Math.ceil(retry.remainingMs / 1000)}s`}
                      style={
                        {
                          ["--progress" as never]: `${Math.round(retry.progress01 * 100)}%`,
                        } as React.CSSProperties
                      }
                    />
                  )}
                </span>
                {role === "master" && (
                  <button
                    type="button"
                    className="sync-status-entkoppeln"
                    onClick={() => handleEntkoppeln(e.peer_id)}
                    disabled={removingId !== null}
                    title="Kasse vom Netzwerk entkoppeln"
                  >
                    {removingId === e.peer_id ? "…" : "Entkoppeln"}
                  </button>
                )}
                <span className="sync-status-url">{e.ws_url}</span>
                <span
                  className={
                    formatZeit(e.last_sync).isStale
                      ? "sync-status-time sync-status-time-stale"
                      : "sync-status-time"
                  }
                >
                  Letzter Sync: {formatZeit(e.last_sync).text}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
