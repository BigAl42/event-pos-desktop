import type { HaendlerItem, AbrechnungZeile } from "../db";
import "./HaendlerverwaltungView.css";

export type HaendlerListeMitUmsatzProps = {
  titel: string;
  list: HaendlerItem[];
  umsatz: Record<string, { summe: number; anzahl: number }>;
  loading: boolean;
  emptyText: string;
  onOpenDrilldown?: (haendlernummer: string, name: string) => void;
};

function displayName(h: HaendlerItem): string {
  if (h.name) return h.name;
  const parts = [h.nachname, h.vorname].filter(Boolean);
  return parts.join(", ") || h.haendlernummer;
}

export function buildUmsatzMap(rows: AbrechnungZeile[]): Record<string, { summe: number; anzahl: number }> {
  const map: Record<string, { summe: number; anzahl: number }> = {};
  for (const row of rows) {
    map[row.haendlernummer] = { summe: row.summe, anzahl: row.anzahl };
  }
  return map;
}

export default function HaendlerListeMitUmsatz({
  titel,
  list,
  umsatz,
  loading,
  emptyText,
  onOpenDrilldown,
}: HaendlerListeMitUmsatzProps) {
  return (
    <section className="haendlerverwaltung-list">
      <h2>{titel}</h2>
      {loading ? (
        <p>Lade…</p>
      ) : list.length === 0 ? (
        <p className="haendlerverwaltung-empty">{emptyText}</p>
      ) : (
        <ul>
          {list.map((h) => {
            const u = umsatz[h.haendlernummer];
            return (
              <li key={h.haendlernummer} className="haendler-slave-row">
                <span className="haendler-nr">{h.haendlernummer}</span>
                <span className="haendler-name">{displayName(h)}</span>
                {h.sort != null && <span className="haendler-sort">({h.sort})</span>}
                <span className="haendler-umsatz">
                  {u ? `${u.summe.toFixed(2)} € (${u.anzahl})` : "0,00 € (0)"}
                </span>
                {onOpenDrilldown && (
                  <button
                    type="button"
                    className="haendler-lupe-button"
                    onClick={() => onOpenDrilldown(h.haendlernummer, displayName(h))}
                    title="Buchungen anzeigen"
                  >
                    Details
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

