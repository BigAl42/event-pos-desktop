import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StornoView from "./StornoView";

vi.mock("../db", () => ({
  getRecentAbrechnungen: vi.fn(),
  getBuchungenForAbrechnung: vi.fn(),
  stornoPosition: vi.fn(),
  stornoAbrechnung: vi.fn(),
}));

vi.mock("../SyncDataContext", () => ({
  useSyncData: () => ({ syncDataVersion: 0 }),
}));

const {
  getRecentAbrechnungen,
  getBuchungenForAbrechnung,
  stornoPosition,
} = await import("../db");
const mockGetRecent = vi.mocked(getRecentAbrechnungen);
const mockGetBuchungen = vi.mocked(getBuchungenForAbrechnung);
vi.mocked(stornoPosition);

describe("StornoView", () => {
  beforeEach(() => {
    mockGetRecent.mockResolvedValue([]);
    mockGetBuchungen.mockResolvedValue([]);
  });

  it("shows empty state when no abrechnungen", async () => {
    render(<StornoView onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/Keine Kundenabrechnungen vorhanden/)).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: /Storno/ })).toBeInTheDocument();
  });

  it("shows list of abrechnungen and detail when one is selected", async () => {
    mockGetRecent.mockResolvedValue([
      {
        id: "ka-1",
        belegnummer: "BELEG-1",
        zeitstempel: "2025-01-15T10:00:00Z",
        kassen_id: "k1",
        kassen_name: "Kasse A",
        summe: 25.5,
        anzahl_positionen: 2,
      },
    ]);
    render(<StornoView onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("BELEG-1")).toBeInTheDocument();
    });
    expect(screen.getByText(/25\.50\s*€/)).toBeInTheDocument();

    mockGetBuchungen.mockResolvedValue([
      { id: "b1", haendlernummer: "H1", betrag: 10.5, bezeichnung: "Pos 1", ist_storniert: false },
      { id: "b2", haendlernummer: "H2", betrag: 15, bezeichnung: null, ist_storniert: false },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /BELEG-1/ }));
    await waitFor(() => {
      expect(screen.getByText("H1")).toBeInTheDocument();
    });
    expect(screen.getByText("10.50 €")).toBeInTheDocument();
    expect(screen.getByText("15.00 €")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Stornieren/ })).toHaveLength(2);
  });

  it("calls onBack when back button is clicked", async () => {
    const onBack = vi.fn();
    render(<StornoView onBack={onBack} />);
    await waitFor(() => {
      expect(screen.getByText(/Keine Kundenabrechnungen/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Zurück/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
