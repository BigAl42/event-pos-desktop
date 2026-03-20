import type { HaendlerItem } from "../db";
import * as XLSX from "xlsx";

const CSV_COLUMNS = [
  "Nummer",
  "Vorname",
  "Nachname",
  "Straße",
  "Hausnummer",
  "PLZ",
  "Stadt",
  "Name",
  "Sortierung",
  "E-Mail",
] as const;

export type HaendlerRow = {
  nummer: string;
  vorname: string;
  nachname: string;
  strasse: string;
  hausnummer: string;
  plz: string;
  stadt: string;
  name: string;
  sort: string;
  email: string;
};

function escapeCsvField(value: string): string {
  if (value.includes('"') || value.includes(",") || value.includes("\n") || value.includes("\r")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function haendlerToRow(h: HaendlerItem): HaendlerRow {
  return {
    nummer: h.haendlernummer ?? "",
    vorname: h.vorname ?? "",
    nachname: h.nachname ?? "",
    strasse: h.strasse ?? "",
    hausnummer: h.hausnummer ?? "",
    plz: h.plz ?? "",
    stadt: h.stadt ?? "",
    name: h.name ?? "",
    sort: h.sort != null ? String(h.sort) : "",
    email: h.email ?? "",
  };
}

export function exportHaendlerCsv(list: HaendlerItem[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = list.map((h) => {
    const r = haendlerToRow(h);
    return [
      escapeCsvField(r.nummer),
      escapeCsvField(r.vorname),
      escapeCsvField(r.nachname),
      escapeCsvField(r.strasse),
      escapeCsvField(r.hausnummer),
      escapeCsvField(r.plz),
      escapeCsvField(r.stadt),
      escapeCsvField(r.name),
      escapeCsvField(r.sort),
      escapeCsvField(r.email),
    ].join(",");
  });
  return [header, ...rows].join("\r\n");
}

export function exportHaendlerExcel(list: HaendlerItem[]): ArrayBuffer {
  const rows = list.map((h) => {
    const r = haendlerToRow(h);
    return [
      r.nummer,
      r.vorname,
      r.nachname,
      r.strasse,
      r.hausnummer,
      r.plz,
      r.stadt,
      r.name,
      r.sort,
      r.email,
    ];
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([CSV_COLUMNS as unknown as string[], ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, "Händler");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let value = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          i++;
          if (line[i] === '"') {
            value += '"';
            i++;
          } else break;
        } else {
          value += line[i];
          i++;
        }
      }
      result.push(value);
      if (line[i] === ",") i++;
    } else {
      const end = line.indexOf(",", i);
      const value = end === -1 ? line.slice(i) : line.slice(i, end);
      result.push(value.trim());
      i = end === -1 ? line.length : end + 1;
    }
  }
  return result;
}

export function parseCsv(content: string): HaendlerRow[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const first = parseCsvLine(lines[0]);
  const hasHeader =
    first.length >= 1 &&
    (first[0] === "Nummer" || first[0] === "nummer" || isNaN(parseInt(first[0], 10)));
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows: HaendlerRow[] = [];
  for (const line of dataLines) {
    const cells = parseCsvLine(line);
    if (cells.length < 1 || !cells[0].trim()) continue;
    rows.push({
      nummer: (cells[0] ?? "").trim(),
      vorname: (cells[1] ?? "").trim(),
      nachname: (cells[2] ?? "").trim(),
      strasse: (cells[3] ?? "").trim(),
      hausnummer: (cells[4] ?? "").trim(),
      plz: (cells[5] ?? "").trim(),
      stadt: (cells[6] ?? "").trim(),
      name: (cells[7] ?? "").trim(),
      sort: (cells[8] ?? "").trim(),
      email: (cells[9] ?? "").trim(),
    });
  }
  return rows;
}

export function parseExcel(buffer: ArrayBuffer): HaendlerRow[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return [];
  const ws = wb.Sheets[firstSheet];
  const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
  if (data.length === 0) return [];
  const firstRow = data[0] as string[];
  const hasHeader =
    firstRow && firstRow.length >= 1 && (firstRow[0] === "Nummer" || firstRow[0] === "nummer");
  const start = hasHeader ? 1 : 0;
  const rows: HaendlerRow[] = [];
  for (let i = start; i < data.length; i++) {
    const row = data[i] as string[];
    if (!row || row.length < 1) continue;
    const nummer = String(row[0] ?? "").trim();
    if (!nummer) continue;
    rows.push({
      nummer,
      vorname: String(row[1] ?? "").trim(),
      nachname: String(row[2] ?? "").trim(),
      strasse: String(row[3] ?? "").trim(),
      hausnummer: String(row[4] ?? "").trim(),
      plz: String(row[5] ?? "").trim(),
      stadt: String(row[6] ?? "").trim(),
      name: String(row[7] ?? "").trim(),
      sort: String(row[8] ?? "").trim(),
      email: String(row[9] ?? "").trim(),
    });
  }
  return rows;
}

export function normalizeNummer(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const n = parseInt(trimmed, 10);
  if (Number.isNaN(n) || n < 1) return trimmed;
  return String(n);
}
