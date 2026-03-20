import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

const A4 = { widthMm: 210, heightMm: 297 } as const;
const MARGIN_MM = 12;
const JPEG_QUALITY = 0.95;

/**
 * Renders an HTML element to PDF bytes (multi-page).
 *
 * We intentionally do NOT use html2pdf.js here because on macOS WebView it can
 * produce blank 1-page PDFs for offscreen/hidden DOM. html2canvas + jsPDF is
 * more predictable for our use case.
 */
export async function elementToPdfBytes(element: HTMLElement): Promise<ArrayBuffer> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const rect = element.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) {
    throw new Error("PDF export failed: element has no size (render not finished?).");
  }

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    scrollX: 0,
    scrollY: 0,
    windowWidth: Math.max(1, element.scrollWidth || element.clientWidth || 1),
    windowHeight: Math.max(1, element.scrollHeight || element.clientHeight || 1),
  });

  const pageW = A4.widthMm - 2 * MARGIN_MM;
  const pageH = A4.heightMm - 2 * MARGIN_MM;

  // Slice the canvas into page-sized chunks to avoid relying on cropping support in jsPDF.
  const sliceHeightPx = Math.max(1, Math.floor((canvas.width * pageH) / pageW));
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  const sliceCanvas = document.createElement("canvas");
  sliceCanvas.width = canvas.width;
  sliceCanvas.height = sliceHeightPx;
  const ctx = sliceCanvas.getContext("2d");
  if (!ctx) throw new Error("PDF export failed: canvas context unavailable.");

  const totalSlices = Math.ceil(canvas.height / sliceHeightPx);
  for (let i = 0; i < totalSlices; i++) {
    const sy = i * sliceHeightPx;
    const sh = Math.min(sliceHeightPx, canvas.height - sy);

    // Resize slice canvas for last page to avoid stretching.
    if (sliceCanvas.height !== sh) sliceCanvas.height = sh;

    ctx.clearRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);

    const imgData = sliceCanvas.toDataURL("image/jpeg", JPEG_QUALITY);
    if (i > 0) pdf.addPage();

    // Height in mm based on slice aspect ratio.
    const sliceHmm = (sh * pageW) / canvas.width;
    pdf.addImage(imgData, "JPEG", MARGIN_MM, MARGIN_MM, pageW, sliceHmm, undefined, "FAST");
  }

  return pdf.output("arraybuffer") as ArrayBuffer;
}

/**
 * Opens save dialog and writes PDF bytes to the chosen path.
 */
export async function saveHandbookPdf(
  pdfBytes: ArrayBuffer,
  defaultFilename: string
): Promise<string | null> {
  const path = await save({
    defaultPath: defaultFilename.endsWith(".pdf") ? defaultFilename : `${defaultFilename}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!path) return null;
  await writeFile(path, new Uint8Array(pdfBytes));
  return path;
}

export function sanitizePdfFilename(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}
