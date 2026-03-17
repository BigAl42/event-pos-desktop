import { useState, useEffect } from "react";
import { getConfig, getSyncStatus, removePeerFromNetwork, type SyncStatusEntry } from "../db";
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
  const [entries, setEntries] = useState<SyncStatusEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    getSyncStatus()
      .then(setEntries)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    getConfig("role").then(setRole);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  async function handleEntkoppeln(peerId: string) {
    const confirmed = window.confirm(
      "Sind Sie sicher, dass Sie die Verbindung zu dieser Kasse trennen möchten?"
    );
    if (!confirmed) {
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

  return (
    <div className="sync-status-view">
      <header className="sync-status-header">
        <button type="button" onClick={onBack}>
          ← Zurück
        </button>
        <h1>Sync-Status</h1>
      </header>

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

      {loading && entries.length === 0 ? (
        <p>Lade…</p>
      ) : entries.length === 0 ? (
        <p className="sync-status-leer">
          Keine Peers konfiguriert. In Einstellungen Sync starten (Hauptkasse: „Sync zu Peers starten“, Nebenkasse: „Sync starten“).
        </p>
      ) : (
        <ul className="sync-status-list">
          {entries.map((e) => (
            <li key={e.peer_id} className="sync-status-item">
              <span className="sync-status-name">{e.name || e.peer_id}</span>
              <span className={`sync-status-badge ${e.connected ? "connected" : "disconnected"}`}>
                {e.connected ? "Verbunden" : "Getrennt"}
              </span>
              <span
                className={
                  formatZeit(e.last_sync).isStale
                    ? "sync-status-time sync-status-time-stale"
                    : "sync-status-time"
                }
              >
                Letzter Sync: {formatZeit(e.last_sync).text}
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
