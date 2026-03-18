import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import KasseView from "./KasseView";

vi.mock("../db", () => ({
  getCurrentKasse: vi.fn(),
  getHaendlerList: vi.fn(),
  createKundenabrechnung: vi.fn(),
  updateKassenPersonen: vi.fn(),
  isInitializedFromMaster: vi.fn(),
  getAbrechnungsläufe: vi.fn(),
}));

const {
  getCurrentKasse,
  getHaendlerList,
  createKundenabrechnung,
  isInitializedFromMaster,
  getAbrechnungsläufe,
} = await import("../db");

const mockGetCurrentKasse = vi.mocked(getCurrentKasse);
const mockGetHaendlerList = vi.mocked(getHaendlerList);
const mockCreateKundenabrechnung = vi.mocked(createKundenabrechnung);
const mockIsInitializedFromMaster = vi.mocked(isInitializedFromMaster);
const mockGetAbrechnungsläufe = vi.mocked(getAbrechnungsläufe);

describe("KasseView", () => {
  beforeEach(() => {
    mockGetCurrentKasse.mockResolvedValue({
      id: "k1",
      name: "Kasse 1",
      person1_name: "A",
      person2_name: "B",
      is_master: 1,
      created_at: new Date().toISOString(),
    });
    mockGetHaendlerList.mockResolvedValue([{ haendlernummer: "1", name: "Händler 1", sort: null }]);
    mockCreateKundenabrechnung.mockResolvedValue("BELEG-2026-001");
    mockIsInitializedFromMaster.mockResolvedValue(true);
    mockGetAbrechnungsläufe.mockResolvedValue([
      { id: "lauf-1", name: "Aktiv", start_zeitpunkt: "", end_zeitpunkt: null, is_aktiv: true },
    ]);
  });

  it("blocks booking when not initialized from master", async () => {
    mockIsInitializedFromMaster.mockResolvedValue(false);

    render(<KasseView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/nicht mit einer Hauptkasse abgestimmt/i);
    });

    expect(
      screen.getByRole("button", { name: /Kundenabrechnung abschließen/i })
    ).toBeDisabled();
  });

  it("blocks booking when no active abrechnungslauf exists", async () => {
    mockGetAbrechnungsläufe.mockResolvedValue([
      { id: "lauf-1", name: "Alt", start_zeitpunkt: "", end_zeitpunkt: "", is_aktiv: false },
    ]);

    render(<KasseView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/Kein aktiver Abrechnungslauf/i);
    });

    expect(
      screen.getByRole("button", { name: /Kundenabrechnung abschließen/i })
    ).toBeDisabled();
  });

  it("asks for confirmation when unknown haendlernummer is used, then books on confirmation", async () => {
    mockGetHaendlerList.mockResolvedValue([{ haendlernummer: "99", name: "Andere", sort: null }]);

    render(<KasseView onBack={() => {}} />);

    const nrInput = await screen.findByPlaceholderText(/^Händlernummer$/);
    const betragInput = screen.getByPlaceholderText(/^Betrag$/);

    fireEvent.change(nrInput, { target: { value: "H1" } });
    fireEvent.change(betragInput, { target: { value: "10,5" } });

    fireEvent.click(screen.getByRole("button", { name: /Kundenabrechnung abschließen/i }));

    await waitFor(() => {
      expect(screen.getByText(/nicht in der Händlerliste/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Trotzdem buchen/i }));

    await waitFor(() => {
      expect(mockCreateKundenabrechnung).toHaveBeenCalledTimes(1);
    });

    expect(mockCreateKundenabrechnung).toHaveBeenCalledWith(
      "k1",
      "A",
      "B",
      expect.arrayContaining([
        expect.objectContaining({ haendlernummer: "H1", betrag: 10.5 }),
      ])
    );
  });

  it("treats 001 as known when list contains 1 (normalization) and books without confirmation", async () => {
    mockGetHaendlerList.mockResolvedValue([{ haendlernummer: "1", name: "Händler 1", sort: null }]);

    render(<KasseView onBack={() => {}} />);

    const nrInput = await screen.findByPlaceholderText(/^Händlernummer$/);
    const betragInput = screen.getByPlaceholderText(/^Betrag$/);

    fireEvent.change(nrInput, { target: { value: "001" } });
    fireEvent.change(betragInput, { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: /Kundenabrechnung abschließen/i }));

    await waitFor(() => {
      expect(mockCreateKundenabrechnung).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText(/Trotzdem buchen/i)).not.toBeInTheDocument();
  });
});

