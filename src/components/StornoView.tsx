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
import "./StornoView.css";

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

export default function StornoView({ onBack }: Props) {
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
    <div className="storno-view">
      <header className="storno-header">
        <button type="button" onClick={onBack}>
          ← Zurück
        </button>
        <h1>Storno</h1>
      </header>

      {error && (
        <div className="storno-error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p>Lade Abrechnungen…</p>
      ) : abrechnungen.length === 0 ? (
        <p className="storno-leer">Keine Kundenabrechnungen vorhanden.</p>
      ) : (
        <div className="storno-layout">
          <section className="storno-list">
            <h2>Letzte Abrechnungen</h2>
            <ul>
              {abrechnungen.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className={`storno-abrechnung-btn ${selectedId === a.id ? "selected" : ""}`}
                    onClick={() => setSelectedId(a.id)}
                  >
                    <span className="storno-abrechnung-beleg">
                      {a.belegnummer ?? a.id.slice(0, 8)}
                    </span>
                    <span className="storno-abrechnung-meta">
                      {formatDatum(a.zeitstempel)} · {a.anzahl_positionen} Pos. · Kasse: {a.kassen_name ?? a.kassen_id}
                    </span>
                    <span className="storno-abrechnung-summe">{a.summe.toFixed(2)} €</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="storno-detail">
            {!selectedId ? (
              <p className="storno-hint">Abrechnung auswählen</p>
            ) : loadingBuchungen ? (
              <p>Lade Positionen…</p>
            ) : (
              <>
                <h2>
                  {selectedAbrechnung?.belegnummer ?? selectedId.slice(0, 8)} –{" "}
                  {formatDatum(selectedAbrechnung?.zeitstempel ?? "")}
                </h2>
                <p className="storno-kasse-info">
                  Erfasst von: {selectedAbrechnung?.kassen_name ?? selectedAbrechnung?.kassen_id ?? "–"}
                </p>
                {hasNonStornierte && (
                  <button
                    type="button"
                    className="storno-ganz-btn"
                    onClick={handleStornoGanzeAbrechnung}
                    disabled={stornoInProgress !== null}
                  >
                    {stornoInProgress === "abrechnung" ? "…" : "Gesamte Abrechnung stornieren"}
                  </button>
                )}
                <table className="storno-table">
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
                            <span className="storno-badge">storniert</span>
                          ) : (
                            <button
                              type="button"
                              className="storno-pos-btn"
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
