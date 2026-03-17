import { useState, useEffect } from "react";
import { getAbrechnung, type AbrechnungZeile, getAbrechnungsläufe } from "../db";
import { useSyncData } from "../SyncDataContext";
import "./AbrechnungView.css";

type Props = { onBack: () => void };

export default function AbrechnungView({ onBack }: Props) {
  const { syncDataVersion } = useSyncData();
  const [rows, setRows] = useState<AbrechnungZeile[]>([]);
  const [loading, setLoading] = useState(true);
  const [aktuellerLaufName, setAktuellerLaufName] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getAbrechnung().then((r) => {
      setRows(r);
      setLoading(false);
    });
    getAbrechnungsläufe()
      .then((läufe) => {
        const aktiver = läufe.find((l) => l.is_aktiv);
        setAktuellerLaufName(aktiver ? aktiver.name : null);
      })
      .catch(() => setAktuellerLaufName(null));
  }, [syncDataVersion]);

  const gesamt = rows.reduce((s, r) => s + r.summe, 0);

  return (
    <div className="abrechnung-view">
      <header className="abrechnung-header">
        <button type="button" onClick={onBack}>← Zurück</button>
        <h1>Abrechnung (Händler)</h1>
        {aktuellerLaufName && (
          <p className="abrechnung-hinweis-lauf">
            Aktueller Abrechnungslauf: <strong>{aktuellerLaufName}</strong>
          </p>
        )}
      </header>

      {loading ? (
        <p>Lade…</p>
      ) : rows.length === 0 ? (
        <p className="abrechnung-leer">Noch keine Buchungen.</p>
      ) : (
        <>
          <table className="abrechnung-table">
            <thead>
              <tr>
                <th>Händlernummer</th>
                <th className="num">Anzahl</th>
                <th className="num">Summe (€)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.haendlernummer}>
                  <td>{r.haendlernummer}</td>
                  <td className="num">{r.anzahl}</td>
                  <td className="num">{r.summe.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="abrechnung-gesamt">
            <strong>Gesamt:</strong> {gesamt.toFixed(2)} €
          </p>
        </>
      )}
    </div>
  );
}
