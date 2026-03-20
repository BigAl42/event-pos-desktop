import { useEffect, useState } from "react";
import {
  getHaendlerList,
  getAbrechnung,
  getAbrechnungsläufe,
  type HaendlerItem,
} from "../db";
import MerchantListWithTotals, { buildUmsatzMap } from "./MerchantListWithTotals";
import "./MerchantAdminView.css";

type Props = {
  onBack: () => void;
  onOpenDrilldown: (haendlernummer: string, name: string) => void;
  onOpenMasterData: () => void;
};

export default function MasterMerchantOverview({
  onBack,
  onOpenDrilldown,
  onOpenMasterData,
}: Props) {
  const [list, setList] = useState<HaendlerItem[]>([]);
  const [umsatz, setUmsatz] = useState<Record<string, { summe: number; anzahl: number }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [aktuellerLaufName, setAktuellerLaufName] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [haendler, abrechnung] = await Promise.all([
          getHaendlerList(),
          getAbrechnung(),
        ] as const);
        setList(haendler);
        setUmsatz(buildUmsatzMap(abrechnung));
        const läufe = await getAbrechnungsläufe();
        const aktiver = läufe.find((l) => l.is_aktiv);
        setAktuellerLaufName(aktiver ? aktiver.name : null);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="haendlerverwaltung-view">
      <header className="haendlerverwaltung-header">
        <button type="button" onClick={onBack}>
          ← Zurück
        </button>
        <h1>Händlerübersicht (Hauptkasse)</h1>
        {aktuellerLaufName && (
          <p className="haendlerverwaltung-lauf-hinweis">
            Aktueller Abrechnungslauf: <strong>{aktuellerLaufName}</strong>
          </p>
        )}
        <button type="button" onClick={onOpenMasterData}>
          Stammdaten verwalten…
        </button>
      </header>

      {error && <p className="haendlerverwaltung-error">{error}</p>}
      <p className="haendlerverwaltung-hint">
        Diese Übersicht zeigt Händler mit Umsätzen im aktuellen Abrechnungslauf. Stammdaten werden in
        einer eigenen Ansicht bearbeitet.
      </p>

      <MerchantListWithTotals
        titel="Händlerliste mit Umsatz"
        list={list}
        umsatz={umsatz}
        loading={loading}
        emptyText="Noch keine Händler angelegt."
        onOpenDrilldown={onOpenDrilldown}
      />
    </div>
  );
}

