/**
 * Copies handbook images from docs/ (canonical) to public/ so Vite serves them
 * at ./handbuch/{de|en}/assets/... for the in-app handbook (base: './' in Tauri).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const pairs = [
  [path.join(root, "docs", "handbuch", "de", "assets"), path.join(root, "public", "handbuch", "de", "assets")],
  [path.join(root, "docs", "handbuch", "en", "assets"), path.join(root, "public", "handbuch", "en", "assets")],
];

for (const [src, dest] of pairs) {
  if (!fs.existsSync(src)) {
    fs.mkdirSync(src, { recursive: true });
    continue;
  }
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}
