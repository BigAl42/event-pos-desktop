import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HaendlerAbrechnungPdf } from "./HaendlerAbrechnungPdf";

describe("HaendlerAbrechnungPdf", () => {
  it("renders required summary fields (stammdaten, lauf, summe)", () => {
    render(
      <HaendlerAbrechnungPdf
        data={{
          haendler: {
            haendlernummer: "H1",
            name: "Händler Muster",
            vorname: null,
            nachname: null,
            strasse: "Musterstraße",
            hausnummer: "1",
            plz: "12345",
            stadt: "Musterstadt",
            email: "haendler@example.com",
          },
          lauf: { id: "lauf-1", name: "Aktueller Lauf", start_zeitpunkt: "", end_zeitpunkt: null },
          werte: { summe: 12.34, anzahl: 3 },
        }}
      />
    );

    expect(screen.getByText(/Händlerabrechnung/)).toBeInTheDocument();
    expect(screen.getAllByText(/Aktueller Lauf/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("H1")).toBeInTheDocument();
    expect(screen.getByText(/12\.34\s*€/)).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/haendler@example\.com/)).toBeInTheDocument();
  });
});

