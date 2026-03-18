import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportElementAsPdf } from "./pdfExport";

const mockSave = vi.fn();
const mockWriteFile = vi.fn();

const mockHtml2canvas = vi.fn();
const mockPdfAddImage = vi.fn();
const mockPdfOutput = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => mockSave(...args),
  confirm: vi.fn().mockResolvedValue(true),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

vi.mock("html2canvas", () => ({
  default: (...args: unknown[]) => mockHtml2canvas(...args),
}));

vi.mock("jspdf", () => ({
  jsPDF: function jsPDF() {
    return {
      addImage: (...args: unknown[]) => mockPdfAddImage(...args),
      output: (...args: unknown[]) => mockPdfOutput(...args),
    };
  },
}));

describe("exportElementAsPdf", () => {
  beforeEach(() => {
    mockSave.mockReset();
    mockWriteFile.mockReset();
    mockHtml2canvas.mockReset();
    mockPdfAddImage.mockReset();
    mockPdfOutput.mockReset();
    mockHtml2canvas.mockResolvedValue({
      toDataURL: () => "data:image/jpeg;base64,TEST",
    });
    mockPdfOutput.mockReturnValue(new ArrayBuffer(3));
  });

  it("returns null when save dialog is cancelled", async () => {
    mockSave.mockResolvedValue(null);
    const el = document.createElement("div");
    const res = await exportElementAsPdf(el, { filenameSuggestion: "Test.pdf" });
    expect(res).toBeNull();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("writes file and returns path on happy path", async () => {
    mockSave.mockResolvedValue("/tmp/out.pdf");
    const el = document.createElement("div");
    const res = await exportElementAsPdf(el, { filenameSuggestion: "Test.pdf" });
    expect(res).toBe("/tmp/out.pdf");
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [, bytes] = mockWriteFile.mock.calls[0];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(mockPdfAddImage).toHaveBeenCalledTimes(1);
  });

  it("sanitizes filename suggestion for defaultPath", async () => {
    mockSave.mockResolvedValue(null);
    const el = document.createElement("div");
    await exportElementAsPdf(el, { filenameSuggestion: 'Abrechnung: H1 / "Lauf"?.pdf' });
    expect(mockSave).toHaveBeenCalledTimes(1);
    const arg = mockSave.mock.calls[0][0] as { defaultPath: string };
    expect(arg.defaultPath).toBe("Abrechnung_ H1 _ _Lauf_.pdf");
  });

  it("creates a single A4 page image PDF", async () => {
    mockSave.mockResolvedValue("/tmp/out.pdf");
    const el = document.createElement("div");
    await exportElementAsPdf(el, { filenameSuggestion: "Test.pdf" });
    expect(mockPdfAddImage).toHaveBeenCalledWith(
      expect.any(String),
      "JPEG",
      0,
      0,
      210,
      297,
      undefined,
      "FAST"
    );
  });
});

describe("exportElementAsPdfToPath", () => {
  beforeEach(() => {
    mockSave.mockReset();
    mockWriteFile.mockReset();
    mockHtml2canvas.mockReset();
    mockPdfAddImage.mockReset();
    mockPdfOutput.mockReset();
    mockHtml2canvas.mockResolvedValue({
      toDataURL: () => "data:image/jpeg;base64,TEST",
    });
    mockPdfOutput.mockReturnValue(new ArrayBuffer(3));
  });

  it("writes file to provided path without showing save dialog", async () => {
    const { exportElementAsPdfToPath } = await import("./pdfExport");
    mockSave.mockResolvedValue("/tmp/should-not-be-used.pdf");
    const el = document.createElement("div");
    const out = await exportElementAsPdfToPath(el, "/tmp/out.pdf");
    expect(out).toBe("/tmp/out.pdf");
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockSave).not.toHaveBeenCalled();
  });
});

