import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HaendlerBuchungenDrilldown from "./HaendlerBuchungenDrilldown";

vi.mock("../db", () => ({
  getBuchungenForHaendler: vi.fn(),
}));

const { getBuchungenForHaendler } = await import("../db");
const mockGetBuchungenForHaendler = vi.mocked(getBuchungenForHaendler);

describe("HaendlerBuchungenDrilldown", () => {
  beforeEach(() => {
    mockGetBuchungenForHaendler.mockResolvedValue([]);
  });

  it("shows empty state when no bookings exist", async () => {
    render(
      <HaendlerBuchungenDrilldown
        haendlernummer="1"
        haendlerName="Test Händler"
        onClose={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Keine Buchungen für diesen Händler/i)).toBeInTheDocument();
    });
  });

  it("groups bookings by kasse and renders group headings", async () => {
    mockGetBuchungenForHaendler.mockResolvedValue([
      {
        id: "b1",
        kassen_id: "k1",
        kassen_name: "Kasse A",
        zeitstempel: "2026-01-01T10:00:00Z",
        haendlernummer: "1",
        betrag: 10,
        bezeichnung: "A",
        ist_storniert: false,
      },
      {
        id: "b2",
        kassen_id: "k2",
        kassen_name: "Kasse B",
        zeitstempel: "2026-01-01T10:00:01Z",
        haendlernummer: "1",
        betrag: 20,
        bezeichnung: "B",
        ist_storniert: false,
      },
    ]);

    render(
      <HaendlerBuchungenDrilldown
        haendlernummer="1"
        haendlerName="Test Händler"
        onClose={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Kasse A")).toBeInTheDocument();
    });
    expect(screen.getByText("Kasse B")).toBeInTheDocument();
  });
});

