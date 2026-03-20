/**
 * Renders high-contrast placeholder PNGs for handbook/README (SVG → PNG via sharp).
 * Replaces nearly-white placeholder bitmaps that look "empty" in the app.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function escXml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function makeSvg(title, subtitle, footer) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="800" height="450" xmlns="http://www.w3.org/2000/svg">
  <rect width="800" height="450" fill="#0f172a"/>
  <rect x="48" y="48" width="704" height="5" fill="#38bdf8" rx="2"/>
  <text x="400" y="185" text-anchor="middle" fill="#f8fafc"
    font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="34" font-weight="600">${escXml(
      title
    )}</text>
  <text x="400" y="242" text-anchor="middle" fill="#94a3b8"
    font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="17">${escXml(subtitle)}</text>
  <text x="400" y="312" text-anchor="middle" fill="#64748b"
    font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="14">${escXml(footer)}</text>
</svg>`;
}

async function writePng(outPath, title, subtitle, footer) {
  const buf = Buffer.from(makeSvg(title, subtitle, footer), "utf8");
  await sharp(buf).png().toFile(outPath);
}

const de = path.join(root, "docs", "handbuch", "de", "assets");
const en = path.join(root, "docs", "handbuch", "en", "assets");

const subDe = "Echte App-Oberfläche: npm run handbook:screenshots (Linux/Windows, tauri-driver)";
const subEn = "Real app UI: npm run handbook:screenshots (Linux/Windows, tauri-driver)";
const footDe = "Platzhalter-Grafik · Kassensystem Handbuch";
const footEn = "Placeholder graphic · Kassensystem handbook";

const specs = [
  { file: "startseite.png", deTitle: "Startseite", enTitle: "Home" },
  { file: "kasse.png", deTitle: "Kasse", enTitle: "Register" },
  { file: "einstellungen.png", deTitle: "Einstellungen", enTitle: "Settings" },
  { file: "handbuch-ansicht.png", deTitle: "Handbuch-Ansicht", enTitle: "Handbook view" },
];

fs.mkdirSync(de, { recursive: true });
fs.mkdirSync(en, { recursive: true });

for (const { file, deTitle, enTitle } of specs) {
  await writePng(path.join(de, file), deTitle, subDe, footDe);
  await writePng(path.join(en, file), enTitle, subEn, footEn);
}

console.info("Wrote placeholder PNGs to docs/handbuch/de|en/assets/ (run: node scripts/sync-handbook-assets.mjs)");
