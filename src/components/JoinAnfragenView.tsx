import { useState, useEffect } from "react";
import {
  getJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
} from "../db";
import type { JoinRequestItem } from "../db";
import "./JoinAnfragenView.css";

type Props = { onBack: () => void };

export default function JoinAnfragenView({ onBack }: Props) {
  const [list, setList] = useState<JoinRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    getJoinRequests()
      .then(setList)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, []);

  async function handleApprove(kassenId: string) {
    setError("");
    setActionId(kassenId);
    try {
      await approveJoinRequest(kassenId);
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setActionId(null);
    }
  }

  async function handleReject(kassenId: string) {
    setError("");
    setActionId(kassenId);
    try {
      await rejectJoinRequest(kassenId);
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setActionId(null);
    }
  }

  return (
    <div className="joinanfragen-view">
      <header className="joinanfragen-header">
        <button type="button" onClick={onBack}>
          ← Zurück
        </button>
        <h1>Join-Anfragen</h1>
      </header>

      <p className="joinanfragen-desc">
        Kassen, die mit dem Join-Token eine Anfrage gesendet haben, erscheinen hier. Annehmen oder Ablehnen.
      </p>

      {error && <p className="joinanfragen-error">{error}</p>}

      {loading && list.length === 0 ? (
        <p>Lade…</p>
      ) : list.length === 0 ? (
        <p className="joinanfragen-empty">Keine ausstehenden Anfragen.</p>
      ) : (
        <ul className="joinanfragen-list">
          {list.map((req) => (
            <li key={req.id}>
              <div className="joinanfragen-item">
                <strong>{req.name}</strong>
                <span className="joinanfragen-id">{req.kassen_id}</span>
                {req.my_ws_url && (
                  <span className="joinanfragen-url">Sync-URL: {req.my_ws_url}</span>
                )}
                {req.cert_fingerprint && (
                  <span className="joinanfragen-url">
                    Zertifikat-Fingerprint: <code>{req.cert_fingerprint}</code>
                  </span>
                )}
                <div className="joinanfragen-actions">
                  <button
                    type="button"
                    className="joinanfragen-approve"
                    onClick={() => handleApprove(req.kassen_id)}
                    disabled={actionId !== null}
                  >
                    {actionId === req.kassen_id ? "…" : "Annehmen"}
                  </button>
                  <button
                    type="button"
                    className="joinanfragen-reject"
                    onClick={() => handleReject(req.kassen_id)}
                    disabled={actionId !== null}
                  >
                    Ablehnen
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
