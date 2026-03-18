import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

type PdfOptions = {
  filenameSuggestion: string;
};

export function sanitizeFilename(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 150);
}

async function renderElementToPdfBytes(element: HTMLElement): Promise<Uint8Array> {
  // Render exactly ONE canvas and place it onto exactly ONE A4 page.
  // This avoids pagination quirks (notably extra blank pages in macOS Preview).
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    windowWidth: Math.max(1, element.scrollWidth || element.clientWidth || 1),
    windowHeight: Math.max(1, element.scrollHeight || element.clientHeight || 1),
  });

  const pdf = new jsPDF({ unit: "mm", format: [210, 297], orientation: "portrait" });
  const imgData = canvas.toDataURL("image/jpeg", 0.98);
  pdf.addImage(imgData, "JPEG", 0, 0, 210, 297, undefined, "FAST");

  const arrayBuffer = pdf.output("arraybuffer") as ArrayBuffer;
  return new Uint8Array(arrayBuffer);
}

export async function exportElementAsPdf(
  element: HTMLElement,
  options: PdfOptions
): Promise<string | null> {
  const suggested = sanitizeFilename(options.filenameSuggestion || "Abrechnung.pdf");

  const path = await save({
    defaultPath: suggested.endsWith(".pdf") ? suggested : `${suggested}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!path) return null;

  const bytes = await renderElementToPdfBytes(element);
  await writeFile(path, bytes);
  return path;
}

export async function exportElementAsPdfToPath(
  element: HTMLElement,
  outputPath: string
): Promise<string> {
  const bytes = await renderElementToPdfBytes(element);
  await writeFile(outputPath, bytes);
  return outputPath;
}

