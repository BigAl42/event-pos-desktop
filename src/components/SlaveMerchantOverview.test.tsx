import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SlaveMerchantOverview from "./SlaveMerchantOverview";

vi.mock("../db", () => ({
  getHaendlerList: vi.fn(),
  getAbrechnung: vi.fn(),
  getAbrechnungsläufe: vi.fn(),
  // Mutations (must not be used in slave view)
  createHaendler: vi.fn(),
  updateHaendler: vi.fn(),
  deleteHaendler: vi.fn(),
}));

const {
  getHaendlerList,
  getAbrechnung,
  getAbrechnungsläufe,
  createHaendler,
  updateHaendler,
  deleteHaendler,
} = await import("../db");

const mockGetHaendlerList = vi.mocked(getHaendlerList);
const mockGetAbrechnung = vi.mocked(getAbrechnung);
const mockGetAbrechnungsläufe = vi.mocked(getAbrechnungsläufe);

describe("SlaveMerchantOverview (read-only)", () => {
  beforeEach(() => {
    mockGetHaendlerList.mockResolvedValue([{ haendlernummer: "1", name: "Händler 1", sort: null }]);
    mockGetAbrechnung.mockResolvedValue([{ haendlernummer: "1", summe: 10.5, anzahl: 2 }]);
    mockGetAbrechnungsläufe.mockResolvedValue([
      { id: "lauf-1", name: "Aktiv", start_zeitpunkt: "", end_zeitpunkt: null, is_aktiv: true },
    ]);
  });

  it("renders list and never calls mutation functions", async () => {
    const onOpenDrilldown = vi.fn();
    render(<SlaveMerchantOverview onBack={() => {}} onOpenDrilldown={onOpenDrilldown} />);

    await waitFor(() => {
      expect(screen.getByText("Händler 1")).toBeInTheDocument();
    });

    expect(screen.getByText(/nur Lesen/i)).toBeInTheDocument();

    expect(vi.mocked(createHaendler)).not.toHaveBeenCalled();
    expect(vi.mocked(updateHaendler)).not.toHaveBeenCalled();
    expect(vi.mocked(deleteHaendler)).not.toHaveBeenCalled();
  });
});

