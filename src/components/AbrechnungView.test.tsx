import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AbrechnungView from "./AbrechnungView";

vi.mock("../db", () => ({
  createAbrechnungslauf: vi.fn(),
  getAbrechnung: vi.fn(),
  getAbrechnungsläufe: vi.fn(),
  getConfig: vi.fn(),
  getHaendlerAbrechnungPdfData: vi.fn(),
  getNotfallExportData: vi.fn(),
  getSyncStatus: vi.fn(),
}));

vi.mock("../SyncDataContext", () => ({
  useSyncData: () => ({ syncDataVersion: 0 }),
}));

vi.mock("react-dom/client", () => ({
  createRoot: () => ({
    render: vi.fn(),
    unmount: vi.fn(),
  }),
}));

vi.mock("../utils/pdfExport", () => ({
  exportElementAsPdf: vi.fn().mockResolvedValue("/tmp/test.pdf"),
  exportElementAsPdfToPath: vi.fn().mockResolvedValue("/tmp/out.pdf"),
  sanitizeFilename: (s: string) => s.split("/").join("_"),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
  confirm: vi.fn().mockResolvedValue(true),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: (...parts: string[]) => Promise.resolve(parts.join("/")),
}));

const {
  createAbrechnungslauf,
  getAbrechnung,
  getAbrechnungsläufe,
  getConfig,
  getHaendlerAbrechnungPdfData,
  getNotfallExportData,
  getSyncStatus,
} = await import("../db");
const { exportElementAsPdf } = await import("../utils/pdfExport");
const { exportElementAsPdfToPath } = await import("../utils/pdfExport");
const { open, save } = await import("@tauri-apps/plugin-dialog");
const { writeTextFile } = await import("@tauri-apps/plugin-fs");
const mockGetAbrechnung = vi.mocked(getAbrechnung);
const mockGetAbrechnungsläufe = vi.mocked(getAbrechnungsläufe);
const mockGetConfig = vi.mocked(getConfig);
const mockGetHaendlerAbrechnungPdfData = vi.mocked(getHaendlerAbrechnungPdfData);
const mockExportElementAsPdf = vi.mocked(exportElementAsPdf);
const mockExportElementAsPdfToPath = vi.mocked(exportElementAsPdfToPath);
const mockOpen = vi.mocked(open);
const mockSave = vi.mocked(save);
const mockWriteTextFile = vi.mocked(writeTextFile);
const mockGetSyncStatus = vi.mocked(getSyncStatus);
const mockGetNotfallExportData = vi.mocked(getNotfallExportData);
const mockCreateAbrechnungslauf = vi.mocked(createAbrechnungslauf);

describe("AbrechnungView", () => {
  beforeEach(() => {
    mockGetAbrechnung.mockReset();
    mockGetAbrechnungsläufe.mockReset();
    mockGetConfig.mockReset();
    mockGetHaendlerAbrechnungPdfData.mockReset();
    mockGetSyncStatus.mockReset();
    mockGetNotfallExportData.mockReset();
    mockCreateAbrechnungslauf.mockReset();
    mockSave.mockReset();
    mockWriteTextFile.mockReset();
    mockGetAbrechnungsläufe.mockResolvedValue([
      { id: "1", name: "Aktueller Lauf", start_zeitpunkt: "", end_zeitpunkt: null, is_aktiv: true },
    ]);
    mockGetConfig.mockResolvedValue("master");
    mockGetSyncStatus.mockResolvedValue([]);
  });

  it("shows loading then empty state when no rows", async () => {
    mockGetAbrechnung.mockResolvedValue([]);
    render(<AbrechnungView onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/Noch keine Buchungen/)).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: /Abrechnung \(Händler\)/ })).toBeInTheDocument();
  });

  it("shows table and total when rows exist", async () => {
    mockGetAbrechnung.mockResolvedValue([
      { haendlernummer: "H1", summe: 10.5, anzahl: 1 },
      { haendlernummer: "H2", summe: 20, anzahl: 2 },
    ]);
    render(<AbrechnungView onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("H1")).toBeInTheDocument();
    });
    expect(screen.getByText("H2")).toBeInTheDocument();
    expect(screen.getByText("10.50")).toBeInTheDocument();
    expect(screen.getByText("20.00")).toBeInTheDocument();
    expect(screen.getByText(/30\.50\s*€/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /PDF erstellen/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Alle PDFs erstellen/ })).toBeInTheDocument();
  });

  it("calls onBack when back button is clicked", async () => {
    mockGetAbrechnung.mockResolvedValue([]);
    const onBack = vi.fn();
    render(<AbrechnungView onBack={onBack} />);
    await waitFor(() => {
      expect(screen.getByText(/Noch keine Buchungen/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Zurück/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("requests DTO for active lauf when PDF button clicked", async () => {
    mockGetAbrechnung.mockResolvedValue([{ haendlernummer: "H1", summe: 10.5, anzahl: 1 }]);
    mockGetHaendlerAbrechnungPdfData.mockResolvedValue({
      haendler: {
        haendlernummer: "H1",
        name: "Test",
        vorname: null,
        nachname: null,
        strasse: null,
        hausnummer: null,
        plz: null,
        stadt: null,
        email: null,
      },
      lauf: { id: "1", name: "Aktueller Lauf", start_zeitpunkt: "", end_zeitpunkt: null },
      werte: { summe: 10.5, anzahl: 1 },
    });
    render(<AbrechnungView onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("H1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /PDF erstellen/ }));
    await waitFor(() =>
      expect(mockGetHaendlerAbrechnungPdfData).toHaveBeenCalledWith("H1", "1")
    );
  });

  it("shows error when no active lauf exists", async () => {
    mockGetAbrechnungsläufe.mockResolvedValueOnce([
      { id: "1", name: "Inaktiv", start_zeitpunkt: "", end_zeitpunkt: null, is_aktiv: false },
    ]);
    mockGetAbrechnung.mockResolvedValue([{ haendlernummer: "H1", summe: 10.5, anzahl: 1 }]);
    render(<AbrechnungView onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("H1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /PDF erstellen/ }));
    expect(await screen.findByText(/Kein aktiver Abrechnungslauf/)).toBeInTheDocument();
    expect(mockGetHaendlerAbrechnungPdfData).not.toHaveBeenCalled();
  });

  it("does not show error when save dialog is cancelled", async () => {
    mockGetAbrechnung.mockResolvedValue([{ haendlernummer: "H1", summe: 10.5, anzahl: 1 }]);
    mockGetHaendlerAbrechnungPdfData.mockResolvedValue({
      haendler: {
        haendlernummer: "H1",
        name: "Test",
        vorname: null,
        nachname: null,
        strasse: null,
        hausnummer: null,
        plz: null,
        stadt: null,
        email: null,
      },
      lauf: { id: "1", name: "Aktueller Lauf", start_zeitpunkt: "", end_zeitpunkt: null },
      werte: { summe: 10.5, anzahl: 1 },
    });
    mockExportElementAsPdf.mockResolvedValueOnce(null);

    render(<AbrechnungView onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("H1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /PDF erstellen/ }));
    await waitFor(() => expect(mockExportElementAsPdf).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Kein aktiver Abrechnungslauf/)).not.toBeInTheDocument();
  });

  it("creates all PDFs into a selected directory", async () => {
    mockGetAbrechnung.mockResolvedValue([
      { haendlernummer: "H1", summe: 10.5, anzahl: 1 },
      { haendlernummer: "H2", summe: 20.0, anzahl: 2 },
    ]);
    mockGetHaendlerAbrechnungPdfData.mockResolvedValue({
      haendler: {
        haendlernummer: "H1",
        name: "Test",
        vorname: null,
        nachname: null,
        strasse: null,
        hausnummer: null,
        plz: null,
        stadt: null,
        email: null,
      },
      lauf: { id: "1", name: "Aktueller Lauf", start_zeitpunkt: "", end_zeitpunkt: null },
      werte: { summe: 10.5, anzahl: 1 },
    });
    mockOpen.mockResolvedValue("/tmp/dir");

    render(<AbrechnungView onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("H1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Alle PDFs erstellen/ }));
    await waitFor(() => expect(mockOpen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockExportElementAsPdfToPath).toHaveBeenCalled());
  });

  it("shows 'Abrechnungslauf abschließen' only for master role", async () => {
    mockGetConfig.mockResolvedValueOnce("slave");
    mockGetAbrechnung.mockResolvedValue([]);
    render(<AbrechnungView onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Noch keine Buchungen/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Abrechnungslauf abschließen/i })).not.toBeInTheDocument();
  });

  it("blocks export step until closeout gate is OK", async () => {
    mockGetAbrechnung.mockResolvedValue([]);
    mockGetSyncStatus.mockResolvedValueOnce([
      {
        peer_id: "peer1",
        name: "Peer 1",
        ws_url: "ws://x",
        connected: true,
        last_sync: null,
        closeout_ok_for_lauf_id: null,
        closeout_ok_at: null,
      },
    ]);
    render(<AbrechnungView onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Noch keine Buchungen/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Abrechnungslauf abschließen/i }));
    await waitFor(() => expect(screen.getByText(/Closeout prüfen/i)).toBeInTheDocument());

    const exportStepBtn = screen.getByRole("button", { name: /2\)\s*Export/i });
    expect(exportStepBtn).toBeDisabled();
    expect(screen.getByText(/Closeout fehlt oder gilt für anderen Lauf/i)).toBeInTheDocument();
  });

  it("allows export step when peer has closeout for active lauf", async () => {
    mockGetAbrechnung.mockResolvedValue([]);
    mockGetSyncStatus.mockResolvedValueOnce([
      {
        peer_id: "peer1",
        name: "Peer 1",
        ws_url: "ws://x",
        connected: true,
        last_sync: null,
        closeout_ok_for_lauf_id: "1",
        closeout_ok_at: new Date("2026-01-01T10:00:00.000Z").toISOString(),
      },
    ]);
    render(<AbrechnungView onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Noch keine Buchungen/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Abrechnungslauf abschließen/i }));
    await waitFor(() => expect(screen.getByText(/Closeout prüfen/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Weiter$/i }));
    await waitFor(() => expect(screen.getByText(/Exporte erstellen/i)).toBeInTheDocument());
  });

  it("writes Notfall-Export JSON and unlocks step 3 only when both exports done", async () => {
    mockGetAbrechnung.mockResolvedValue([{ haendlernummer: "H1", summe: 10.5, anzahl: 1 }]);
    mockGetHaendlerAbrechnungPdfData.mockResolvedValue({
      haendler: {
        haendlernummer: "H1",
        name: "Test",
        vorname: null,
        nachname: null,
        strasse: null,
        hausnummer: null,
        plz: null,
        stadt: null,
        email: null,
      },
      lauf: { id: "1", name: "Aktueller Lauf", start_zeitpunkt: "", end_zeitpunkt: null },
      werte: { summe: 10.5, anzahl: 1 },
    });
    mockOpen.mockResolvedValue("/tmp/dir");
    mockSave.mockResolvedValue("/tmp/notfall.json");
    mockGetSyncStatus.mockResolvedValueOnce([
      {
        peer_id: "peer1",
        name: "Peer 1",
        ws_url: "ws://x",
        connected: true,
        last_sync: null,
        closeout_ok_for_lauf_id: "1",
        closeout_ok_at: new Date("2026-01-01T10:00:00.000Z").toISOString(),
      },
    ]);
    mockGetNotfallExportData.mockResolvedValue({
      meta: {
        exported_lauf_id: "1",
        exported_lauf_name: "Aktueller Lauf",
        exported_lauf_start_zeitpunkt: "2026-01-01T00:00:00.000Z",
        exported_lauf_end_zeitpunkt: null,
        export_at: "2026-01-01T12:00:00.000Z",
        exporting_kasse_id: null,
        exporting_kasse_name: null,
      },
      kassen: [],
      kundenabrechnungen: [],
      buchungen: [],
      stornos: [],
    });

    render(<AbrechnungView onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("H1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Abrechnungslauf abschließen/i }));
    await waitFor(() => expect(screen.getByText(/Closeout prüfen/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Weiter$/i }));
    await waitFor(() => expect(screen.getByText(/Exporte erstellen/i)).toBeInTheDocument());

    const modal = screen.getByRole("heading", { name: /Abrechnungslauf abschließen/i }).closest(".abrechnung-modal");
    if (!modal || !(modal instanceof HTMLElement)) throw new Error("Modal not found");
    const w = within(modal);

    const step3Btn = screen.getByRole("button", { name: /3\)\s*Neuer Lauf/i });
    expect(step3Btn).toBeDisabled();

    fireEvent.click(w.getByRole("button", { name: /Notfall-Export speichern/i }));
    await waitFor(() => expect(mockWriteTextFile).toHaveBeenCalledTimes(1));
    expect(step3Btn).toBeDisabled();

    fireEvent.click(w.getByRole("button", { name: /Alle PDFs erstellen/i }));
    await waitFor(() => expect(mockExportElementAsPdfToPath).toHaveBeenCalled());

    await waitFor(() => expect(w.getByRole("button", { name: /^Weiter$/i })).toBeEnabled());
    fireEvent.click(w.getByRole("button", { name: /^Weiter$/i }));
    await waitFor(() => expect(screen.getByText(/Neuen Abrechnungslauf starten/i)).toBeInTheDocument());
  });

  it("starts new lauf via createAbrechnungslauf from wizard", async () => {
    mockGetAbrechnung.mockResolvedValue([{ haendlernummer: "H1", summe: 10.5, anzahl: 1 }]);
    mockGetHaendlerAbrechnungPdfData.mockResolvedValue({
      haendler: {
        haendlernummer: "H1",
        name: "Test",
        vorname: null,
        nachname: null,
        strasse: null,
        hausnummer: null,
        plz: null,
        stadt: null,
        email: null,
      },
      lauf: { id: "1", name: "Aktueller Lauf", start_zeitpunkt: "", end_zeitpunkt: null },
      werte: { summe: 10.5, anzahl: 1 },
    });
    mockOpen.mockResolvedValue("/tmp/dir");
    mockSave.mockResolvedValue("/tmp/notfall.json");
    mockGetNotfallExportData.mockResolvedValue({
      meta: {
        exported_lauf_id: "1",
        exported_lauf_name: "Aktueller Lauf",
        exported_lauf_start_zeitpunkt: "2026-01-01T00:00:00.000Z",
        exported_lauf_end_zeitpunkt: null,
        export_at: "2026-01-01T12:00:00.000Z",
        exporting_kasse_id: null,
        exporting_kasse_name: null,
      },
      kassen: [],
      kundenabrechnungen: [],
      buchungen: [],
      stornos: [],
    });
    mockGetSyncStatus.mockResolvedValueOnce([]); // no peers => gate ok

    render(<AbrechnungView onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("H1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Abrechnungslauf abschließen/i }));
    await waitFor(() => expect(screen.getByText(/Closeout prüfen/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Weiter$/i }));
    await waitFor(() => expect(screen.getByText(/Exporte erstellen/i)).toBeInTheDocument());

    const modal = screen.getByRole("heading", { name: /Abrechnungslauf abschließen/i }).closest(".abrechnung-modal");
    if (!modal || !(modal instanceof HTMLElement)) throw new Error("Modal not found");
    const w = within(modal);

    fireEvent.click(w.getByRole("button", { name: /Notfall-Export speichern/i }));
    await waitFor(() => expect(mockWriteTextFile).toHaveBeenCalled());

    fireEvent.click(w.getByRole("button", { name: /Alle PDFs erstellen/i }));
    await waitFor(() => expect(mockExportElementAsPdfToPath).toHaveBeenCalled());

    await waitFor(() => expect(w.getByRole("button", { name: /^Weiter$/i })).toBeEnabled());
    fireEvent.click(w.getByRole("button", { name: /^Weiter$/i }));
    await waitFor(() => expect(screen.getByText(/Neuen Abrechnungslauf starten/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Ja, neuen Lauf starten/i }));
    await waitFor(() => expect(mockCreateAbrechnungslauf).toHaveBeenCalledTimes(1));
  });
});
