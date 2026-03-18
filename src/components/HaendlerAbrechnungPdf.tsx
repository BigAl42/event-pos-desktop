import "./HaendlerAbrechnungPdf.css";

type Props = {
  data: {
    haendler: {
      haendlernummer: string;
      name: string;
      vorname: string | null;
      nachname: string | null;
      strasse: string | null;
      hausnummer: string | null;
      plz: string | null;
      stadt: string | null;
      email: string | null;
    };
    lauf: {
      id: string;
      name: string;
      start_zeitpunkt: string;
      end_zeitpunkt: string | null;
    };
    werte: { summe: number; anzahl: number };
  };
};

function formatMoneyEUR(value: number): string {
  return `${value.toFixed(2)} €`;
}

function formatIso(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("de-DE");
}

function joinAddress(parts: (string | null | undefined)[]): string {
  return parts.filter((p) => p && p.trim().length > 0).join(" ");
}

export function HaendlerAbrechnungPdf({ data }: Props) {
  const h = data.haendler;
  const l = data.lauf;
  const summe = data.werte.summe;

  const haendlerName = h.name || `${h.vorname ?? ""} ${h.nachname ?? ""}`.trim();
  const strasseHaus = joinAddress([h.strasse, h.hausnummer]);
  const plzStadt = joinAddress([h.plz, h.stadt]);

  return (
    <div className="haendler-abrechnung-pdf" data-testid="haendler-abrechnung-pdf">
      <header className="haendler-abrechnung-pdf__header">
        <div>
          <div className="haendler-abrechnung-pdf__title">Händlerabrechnung</div>
          <div className="haendler-abrechnung-pdf__subtitle">Abrechnungslauf: {l.name}</div>
        </div>
        <div className="haendler-abrechnung-pdf__meta">
          <div>
            <span className="k">Lauf-ID</span>
            <span className="v mono">{l.id}</span>
          </div>
          <div>
            <span className="k">Erstellt</span>
            <span className="v">{formatIso(new Date().toISOString())}</span>
          </div>
        </div>
      </header>

      <section className="haendler-abrechnung-pdf__grid">
        <div className="haendler-abrechnung-pdf__card">
          <div className="haendler-abrechnung-pdf__cardTitle">Händler (Stammdaten)</div>
          <div className="haendler-abrechnung-pdf__kv">
            <div className="k">Händlernummer</div>
            <div className="v mono">{h.haendlernummer}</div>
            <div className="k">Name</div>
            <div className="v">{haendlerName}</div>
            <div className="k">Adresse</div>
            <div className="v">
              {strasseHaus || "—"}
              <br />
              {plzStadt || "—"}
            </div>
            <div className="k">E-Mail</div>
            <div className="v">{h.email || "—"}</div>
          </div>
        </div>

        <div className="haendler-abrechnung-pdf__card">
          <div className="haendler-abrechnung-pdf__cardTitle">Abrechnungslauf</div>
          <div className="haendler-abrechnung-pdf__kv">
            <div className="k">Name</div>
            <div className="v">{l.name}</div>
            <div className="k">Start</div>
            <div className="v">{formatIso(l.start_zeitpunkt)}</div>
            <div className="k">Ende</div>
            <div className="v">{formatIso(l.end_zeitpunkt)}</div>
          </div>
        </div>
      </section>

      <section className="haendler-abrechnung-pdf__summe">
        <div className="haendler-abrechnung-pdf__summeLabel">Gesamtsumme</div>
        <div className="haendler-abrechnung-pdf__summeValue">{formatMoneyEUR(summe)}</div>
      </section>

      <section className="haendler-abrechnung-pdf__facts">
        <div className="fact">
          <div className="k">Anzahl Buchungen</div>
          <div className="v">{data.werte.anzahl}</div>
        </div>
      </section>

      <footer className="haendler-abrechnung-pdf__footer">
        <div className="line" />
        <div className="hint">Hinweis: Diese Abrechnung ist eine Zusammenfassung (ohne Einzelbuchungen).</div>
      </footer>
    </div>
  );
}

