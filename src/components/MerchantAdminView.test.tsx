import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MerchantAdminView from "./MerchantAdminView";
import type { HaendlerItem } from "../db";

vi.mock("../db", () => ({
  getHaendlerList: vi.fn(),
  createHaendler: vi.fn(),
  updateHaendler: vi.fn(),
  deleteHaendler: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

const { mockCsvRow, mockExcelRow } = vi.hoisted(() => ({
  mockCsvRow: {
    nummer: "1",
    name: "Import Test",
    vorname: "Max",
    nachname: "Muster",
    strasse: "",
    hausnummer: "",
    plz: "",
    stadt: "",
    sort: "",
    email: "",
  },
  mockExcelRow: {
    nummer: "2",
    name: "Excel Import",
    vorname: "",
    nachname: "",
    strasse: "",
    hausnummer: "",
    plz: "",
    stadt: "",
    sort: "",
    email: "",
  },
}));

vi.mock("../utils/merchantImportExport", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../utils/merchantImportExport")>();
  return {
    ...mod,
    exportHaendlerCsv: vi.fn((list: HaendlerItem[]) => mod.exportHaendlerCsv(list)),
    exportHaendlerExcel: vi.fn((list: HaendlerItem[]) => mod.exportHaendlerExcel(list)),
    parseCsv: vi.fn().mockReturnValue([mockCsvRow]),
    parseExcel: vi.fn().mockReturnValue([mockExcelRow]),
  };
});

const { getHaendlerList, createHaendler, updateHaendler, deleteHaendler } = await import("../db");
const { save } = await import("@tauri-apps/plugin-dialog");
const { writeTextFile, writeFile } = await import("@tauri-apps/plugin-fs");
const { exportHaendlerCsv, exportHaendlerExcel } = await import("../utils/merchantImportExport");
const mockSave = vi.mocked(save);
const mockWriteTextFile = vi.mocked(writeTextFile);
const mockWriteFile = vi.mocked(writeFile);
const mockExportHaendlerCsv = vi.mocked(exportHaendlerCsv);
const mockExportHaendlerExcel = vi.mocked(exportHaendlerExcel);
const mockGetHaendlerList = vi.mocked(getHaendlerList);
const mockCreateHaendler = vi.mocked(createHaendler);
const mockUpdateHaendler = vi.mocked(updateHaendler);
const mockDeleteHaendler = vi.mocked(deleteHaendler);

function mockHaendler(overrides: Partial<HaendlerItem> = {}): HaendlerItem {
  return {
    haendlernummer: "1",
    name: "Test Händler",
    sort: null,
    ...overrides,
  };
}

describe("MerchantAdminView", () => {
  beforeEach(() => {
    mockGetHaendlerList.mockReset();
    mockCreateHaendler.mockReset();
    mockUpdateHaendler.mockReset();
    mockDeleteHaendler.mockReset();
    mockGetHaendlerList.mockResolvedValue([]);
    mockCreateHaendler.mockResolvedValue();
    mockUpdateHaendler.mockResolvedValue();
    mockDeleteHaendler.mockResolvedValue();
    mockSave.mockReset();
    mockSave.mockResolvedValue(null);
    mockWriteTextFile.mockReset();
    mockWriteTextFile.mockResolvedValue(undefined);
    mockWriteFile.mockReset();
    mockWriteFile.mockResolvedValue(undefined);
    mockExportHaendlerCsv.mockClear();
    mockExportHaendlerExcel.mockClear();
  });

  it("shows header, empty list message and Neuer Händler when list is empty", async () => {
    render(<MerchantAdminView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Zurück/ })).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: /Händlerverwaltung/ })).toBeInTheDocument();
    expect(screen.getByText(/Noch keine Händler angelegt/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Neuer Händler/ })).toBeInTheDocument();
  });

  it("shows list with haendler nummer, name and Bearbeiten/Löschen buttons", async () => {
    mockGetHaendlerList.mockResolvedValue([mockHaendler({ haendlernummer: "42", name: "Meier GmbH" })]);

    render(<MerchantAdminView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });
    expect(screen.getByText("Meier GmbH")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bearbeiten/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Löschen/ })).toBeInTheDocument();
  });

  it("calls onBack when Zurück is clicked", async () => {
    const onBack = vi.fn();
    render(<MerchantAdminView onBack={onBack} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Zurück/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Zurück/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("shows error when saving without Nummer", async () => {
    render(<MerchantAdminView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Speichern/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Speichern/ }));

    await waitFor(() => {
      expect(screen.getByText(/Nummer ist Pflicht/)).toBeInTheDocument();
    });
    expect(mockCreateHaendler).not.toHaveBeenCalled();
  });

  it("shows error when saving with Nummer but no name fields", async () => {
    render(<MerchantAdminView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/^Nummer$/)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^Nummer$/), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /Speichern/ }));

    await waitFor(() => {
      expect(screen.getByText(/Mindestens ein Name/)).toBeInTheDocument();
    });
    expect(mockCreateHaendler).not.toHaveBeenCalled();
  });

  it("calls createHaendler and reloads when saving valid new haendler", async () => {
    render(<MerchantAdminView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/^Nummer$/)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^Nummer$/), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/Name \/ Bezeichnung/), { target: { value: "Neuer Stand" } });
    fireEvent.click(screen.getByRole("button", { name: /Speichern/ }));

    await waitFor(() => {
      expect(mockCreateHaendler).toHaveBeenCalledWith(
        expect.objectContaining({
          haendlernummer: "3",
          name: "Neuer Stand",
        })
      );
    });
    expect(mockGetHaendlerList).toHaveBeenCalledTimes(2);
  });

  it("opens form with haendler values when Bearbeiten is clicked", async () => {
    mockGetHaendlerList.mockResolvedValue([
      mockHaendler({ haendlernummer: "10", name: "Bearbeiten Test", vorname: "Max", nachname: "Muster" }),
    ]);

    render(<MerchantAdminView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Bearbeiten/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Bearbeiten/ }));

    expect(screen.getByRole("heading", { name: /Händler bearbeiten/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nummer$/)).toHaveValue(10);
    expect(screen.getByLabelText(/Name \/ Bezeichnung/)).toHaveValue("Bearbeiten Test");
    expect(screen.getByLabelText(/^Vorname$/)).toHaveValue("Max");
    expect(screen.getByLabelText(/^Nachname$/)).toHaveValue("Muster");
  });

  it("calls updateHaendler when saving edited haendler without changing number", async () => {
    mockGetHaendlerList.mockResolvedValue([mockHaendler({ haendlernummer: "7", name: "Alt" })]);

    render(<MerchantAdminView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Bearbeiten/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Bearbeiten/ }));
    fireEvent.change(screen.getByLabelText(/Name \/ Bezeichnung/), { target: { value: "Geändert" } });
    fireEvent.click(screen.getByRole("button", { name: /Speichern/ }));

    await waitFor(() => {
      expect(mockUpdateHaendler).toHaveBeenCalledWith(
        "7",
        expect.objectContaining({ name: "Geändert" })
      );
    });
  });

  it("calls deleteHaendler when Löschen is clicked (confirm mocked true)", async () => {
    mockGetHaendlerList.mockResolvedValue([mockHaendler({ haendlernummer: "99", name: "Zum Löschen" })]);

    render(<MerchantAdminView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Löschen/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Löschen/ }));

    await waitFor(() => {
      expect(mockDeleteHaendler).toHaveBeenCalledWith("99");
    });
    expect(mockGetHaendlerList).toHaveBeenCalledTimes(2);
  });

  it("shows error when createHaendler rejects", async () => {
    mockCreateHaendler.mockRejectedValue(new Error("DB voll"));

    render(<MerchantAdminView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/^Nummer$/)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^Nummer$/), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/Name \/ Bezeichnung/), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: /Speichern/ }));

    await waitFor(() => {
      expect(screen.getByText(/DB voll/)).toBeInTheDocument();
    });
    expect(screen.getByText(/DB voll/)).toHaveClass("merchant-admin-error");
  });

  it("export CSV calls exportHaendlerCsv and writeTextFile when save returns path", async () => {
    const list = [mockHaendler({ haendlernummer: "42", name: "Meier GmbH" })];
    mockGetHaendlerList.mockResolvedValue(list);
    mockSave.mockResolvedValue("/tmp/haendler.csv");

    render(<MerchantAdminView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Export CSV/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));

    await waitFor(() => {
      expect(screen.getByText(/CSV exportiert/)).toBeInTheDocument();
    });
    expect(mockExportHaendlerCsv).toHaveBeenCalledWith(list);
    expect(mockWriteTextFile).toHaveBeenCalledTimes(1);
    expect(mockWriteTextFile).toHaveBeenCalledWith("/tmp/haendler.csv", expect.stringMatching(/^\uFEFF/));
  });

  it("export Excel calls exportHaendlerExcel and writeFile when save returns path", async () => {
    const list = [mockHaendler({ haendlernummer: "10", name: "Excel Test" })];
    mockGetHaendlerList.mockResolvedValue(list);
    mockSave.mockResolvedValue("/tmp/haendler.xlsx");

    render(<MerchantAdminView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Export Excel/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Export Excel/ }));

    await waitFor(() => {
      expect(screen.getByText(/Excel exportiert/)).toBeInTheDocument();
    });
    expect(mockExportHaendlerExcel).toHaveBeenCalledWith(list);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledWith("/tmp/haendler.xlsx", expect.any(Uint8Array));
  });

  it("shows Export fehlgeschlagen when writeTextFile rejects", async () => {
    const list = [mockHaendler({ haendlernummer: "1", name: "X" })];
    mockGetHaendlerList.mockResolvedValue(list);
    mockSave.mockResolvedValue("/tmp/haendler.csv");
    mockWriteTextFile.mockRejectedValue(new Error("Disk voll"));

    render(<MerchantAdminView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Export CSV/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));

    await waitFor(() => {
      expect(screen.getByText(/Export fehlgeschlagen/)).toBeInTheDocument();
    });
  });

  it("import CSV creates haendler via createHaendler when file has valid CSV", async () => {
    mockGetHaendlerList.mockResolvedValue([]);
    const file = {
      name: "haendler.csv",
      text: () => Promise.resolve(""),
    };
    const fileList = { 0: file, length: 1, item: (i: number) => (i === 0 ? file : null) };

    const { container } = render(<MerchantAdminView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Import CSV \/ Excel/ })).toBeInTheDocument();
    });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();
    Object.defineProperty(fileInput, "files", { value: fileList, configurable: true });
    fireEvent.change(fileInput, { target: fileInput });

    await waitFor(
      () => {
        expect(mockCreateHaendler).toHaveBeenCalledWith(
          expect.objectContaining({
            haendlernummer: "1",
            name: "Import Test",
          })
        );
      },
      { timeout: 3000 }
    );
    expect(screen.getByText(/1 Händler angelegt/)).toBeInTheDocument();
  });

  it("import Excel creates haendler via createHaendler when parseExcel returns row", async () => {
    mockGetHaendlerList.mockResolvedValue([]);
    const file = {
      name: "test.xlsx",
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    };
    const fileList = { 0: file, length: 1, item: (i: number) => (i === 0 ? file : null) };

    const { container } = render(<MerchantAdminView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Import CSV \/ Excel/ })).toBeInTheDocument();
    });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();
    Object.defineProperty(fileInput, "files", { value: fileList, configurable: true });
    fireEvent.change(fileInput, { target: fileInput });

    await waitFor(
      () => {
        expect(mockCreateHaendler).toHaveBeenCalledWith(
          expect.objectContaining({
            haendlernummer: "2",
            name: "Excel Import",
          })
        );
      },
      { timeout: 3000 }
    );
    expect(screen.getByText(/1 Händler angelegt/)).toBeInTheDocument();
  });
});
