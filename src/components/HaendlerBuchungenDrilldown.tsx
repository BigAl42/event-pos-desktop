import { useEffect, useState } from "react";
import { getBuchungenForHaendler, type HaendlerBuchungItem } from "../db";
import "./AbrechnungView.css";

type Props = {
  haendlernummer: string;
  haendlerName: string;
  onClose: () => void;
};

function formatZeit(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function groupByKasse(items: HaendlerBuchungItem[]): Record<string, HaendlerBuchungItem[]> {
  const groups: Record<string, HaendlerBuchungItem[]> = {};
  for (const item of items) {
    const key = item.kassen_id || "unknown";
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

export default function HaendlerBuchungenDrilldown({ haendlernummer, haendlerName, onClose }: Props) {
  const [rows, setRows] = useState<HaendlerBuchungItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    getBuchungenForHaendler(haendlernummer)
      .then((r) => setRows(r))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [haendlernummer]);

  const groups = groupByKasse(rows);

  function handleExportCsv() {
    const header = [
      "Kassen-ID",
      "Kassenname",
      "Zeitstempel",
      "Buchungs-ID",
      "Händlernummer",
      "Betrag",
      "Bezeichnung",
      "Storniert",
    ];
    const lines = [header.join(";")];
    for (const item of rows) {
      lines.push(
        [
          item.kassen_id,
          item.kassen_name ?? "",
          formatZeit(item.zeitstempel),
          item.id,
          item.haendlernummer,
          item.betrag.toFixed(2).replace(".", ","),
          (item.bezeichnung ?? "").replace(/;/g, ","),
          item.ist_storniert ? "ja" : "nein",
        ].join(";"),
      );
    }
    const csv = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `haendler_${haendlernummer}_buchungen.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handlePrint() {
    const original = document.body.innerHTML;
    const title = document.title;
    const content = document.getElementById("haendler-drilldown-print-root")?.innerHTML ?? "";
    document.body.innerHTML = content;
    window.print();
    document.body.innerHTML = original;
    document.title = title;
  }

  return (
    <div className="abrechnung-view">
      <header className="abrechnung-header">
        <button type="button" onClick={onClose}>
          ← Zurück
        </button>
        <h1>
          Buchungen Händler {haendlernummer} – {haendlerName}
        </h1>
      </header>

      {error && <p className="abrechnung-error">{error}</p>}

      <div className="abrechnung-actions">
        <button type="button" onClick={handleExportCsv}>
          Export CSV
        </button>
        <button type="button" onClick={handlePrint}>
          Drucken
        </button>
      </div>

      {loading ? (
        <p>Lade…</p>
      ) : rows.length === 0 ? (
        <p className="abrechnung-leer">Keine Buchungen für diesen Händler im aktuellen Abrechnungslauf.</p>
      ) : (
        <div id="haendler-drilldown-print-root">
          {Object.entries(groups).map(([kassenId, items]) => (
            <section key={kassenId} className="abrechnung-kassen-gruppe">
              <h2>{items[0].kassen_name || kassenId}</h2>
              <table className="abrechnung-table">
                <thead>
                  <tr>
                    <th>Zeit</th>
                    <th>Beleg</th>
                    <th className="num">Betrag (€)</th>
                    <th>Bezeichnung</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id}>
                      <td>{formatZeit(r.zeitstempel)}</td>
                      <td>{r.id}</td>
                      <td className="num">{r.betrag.toFixed(2)}</td>
                      <td>{r.bezeichnung ?? ""}</td>
                      <td>{r.ist_storniert ? "storniert" : "ok"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

