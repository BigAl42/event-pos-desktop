import { useState, useEffect } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  getRecentAbrechnungen,
  getBuchungenForAbrechnung,
  stornoPosition,
  stornoAbrechnung,
  type KundenabrechnungListItem,
  type BuchungListItem,
} from "../db";
import { useSyncData } from "../SyncDataContext";
import "./VoidView.css";

type Props = { onBack: () => void };

function formatDatum(zeitstempel: string): string {
  try {
    const d = new Date(zeitstempel);
    return d.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return zeitstempel;
  }
}

export default function VoidView({ onBack }: Props) {
  const { syncDataVersion } = useSyncData();
  const [abrechnungen, setAbrechnungen] = useState<KundenabrechnungListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [buchungen, setBuchungen] = useState<BuchungListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingBuchungen, setLoadingBuchungen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stornoInProgress, setStornoInProgress] = useState<string | null>(null);

  function loadAbrechnungen() {
    setLoading(true);
    setError(null);
    getRecentAbrechnungen(50)
      .then((list) => {
        setAbrechnungen(list);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }

  useEffect(() => {
    loadAbrechnungen();
  }, [syncDataVersion]);

  useEffect(() => {
    if (!selectedId) {
      setBuchungen([]);
      return;
    }
    setLoadingBuchungen(true);
    getBuchungenForAbrechnung(selectedId)
      .then(setBuchungen)
      .finally(() => setLoadingBuchungen(false));
  }, [selectedId]);

  const selectedAbrechnung = abrechnungen.find((a) => a.id === selectedId);
  const hasNonStornierte = buchungen.some((b) => !b.ist_storniert);

  async function handleStornoPosition(buchungId: string) {
    setStornoInProgress(buchungId);
    try {
      await stornoPosition(buchungId);
      setBuchungen((prev) =>
        prev.map((b) => (b.id === buchungId ? { ...b, ist_storniert: true } : b))
      );
      loadAbrechnungen();
    } catch (e) {
      setError(String(e));
    } finally {
      setStornoInProgress(null);
    }
  }

  async function handleStornoGanzeAbrechnung() {
    if (!selectedId || !hasNonStornierte) return;
    const ok = await confirm(
      "Gesamte Abrechnung stornieren? Alle nicht stornierten Positionen werden storniert.",
      {
        title: "Gesamte Abrechnung stornieren",
        kind: "warning",
        okLabel: "Stornieren",
        cancelLabel: "Abbrechen",
      }
    );
    if (!ok) return;
    setStornoInProgress("abrechnung");
    try {
      await stornoAbrechnung(selectedId);
      setBuchungen((prev) => prev.map((b) => ({ ...b, ist_storniert: true })));
      loadAbrechnungen();
    } catch (e) {
      setError(String(e));
    } finally {
      setStornoInProgress(null);
    }
  }

  return (
    <div className="void-view">
      <header className="void-header">
        <button type="button" onClick={onBack}>
          ← Zurück
        </button>
        <h1>Storno</h1>
      </header>

      {error && (
        <div className="void-error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p>Lade Abrechnungen…</p>
      ) : abrechnungen.length === 0 ? (
        <p className="void-leer">Keine Kundenabrechnungen vorhanden.</p>
      ) : (
        <div className="void-layout">
          <section className="void-list">
            <h2>Letzte Abrechnungen</h2>
            <ul>
              {abrechnungen.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className={`void-abrechnung-btn ${selectedId === a.id ? "selected" : ""}`}
                    onClick={() => setSelectedId(a.id)}
                  >
                    <span className="void-abrechnung-beleg">
                      {a.belegnummer ?? a.id.slice(0, 8)}
                    </span>
                    <span className="void-abrechnung-meta">
                      {formatDatum(a.zeitstempel)} · {a.anzahl_positionen} Pos. · Kasse: {a.kassen_name ?? a.kassen_id}
                    </span>
                    <span className="void-abrechnung-summe">{a.summe.toFixed(2)} €</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="void-detail">
            {!selectedId ? (
              <p className="void-hint">Abrechnung auswählen</p>
            ) : loadingBuchungen ? (
              <p>Lade Positionen…</p>
            ) : (
              <>
                <h2>
                  {selectedAbrechnung?.belegnummer ?? selectedId.slice(0, 8)} –{" "}
                  {formatDatum(selectedAbrechnung?.zeitstempel ?? "")}
                </h2>
                <p className="void-kasse-info">
                  Erfasst von: {selectedAbrechnung?.kassen_name ?? selectedAbrechnung?.kassen_id ?? "–"}
                </p>
                {hasNonStornierte && (
                  <button
                    type="button"
                    className="void-ganz-btn"
                    onClick={handleStornoGanzeAbrechnung}
                    disabled={stornoInProgress !== null}
                  >
                    {stornoInProgress === "abrechnung" ? "…" : "Gesamte Abrechnung stornieren"}
                  </button>
                )}
                <table className="void-table">
                  <thead>
                    <tr>
                      <th>Händler</th>
                      <th className="num">Betrag</th>
                      <th>Bezeichnung</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {buchungen.map((b) => (
                      <tr key={b.id} className={b.ist_storniert ? "storniert" : ""}>
                        <td>{b.haendlernummer}</td>
                        <td className="num">{b.betrag.toFixed(2)} €</td>
                        <td>{b.bezeichnung ?? "–"}</td>
                        <td>
                          {b.ist_storniert ? (
                            <span className="void-badge">storniert</span>
                          ) : (
                            <button
                              type="button"
                              className="void-pos-btn"
                              onClick={() => handleStornoPosition(b.id)}
                              disabled={stornoInProgress !== null}
                            >
                              {stornoInProgress === b.id ? "…" : "Stornieren"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
