import * as XLSX from "xlsx";
import type { NotfallExportDto } from "../db";

const SHEET_META = "META";
const SHEET_KASSEN = "KASSEN";
const SHEET_KUNDENABRECHNUNG = "KUNDENABRECHNUNG";
const SHEET_BUCHUNGEN = "BUCHUNGEN";
const SHEET_STORNOS = "STORNOS";

function asString(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

function asNullableString(v: unknown): string | null {
  const s = asString(v).trim();
  return s ? s : null;
}

function asNumber(v: unknown): number {
  if (typeof v === "number") return v;
  const s = asString(v).trim();
  if (!s) return 0;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function buildEmergencyExcel(dto: NotfallExportDto): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  const metaRows: (string | null)[][] = [
    ["exported_lauf_id", dto.meta.exported_lauf_id],
    ["exported_lauf_name", dto.meta.exported_lauf_name],
    ["exported_lauf_start_zeitpunkt", dto.meta.exported_lauf_start_zeitpunkt],
    ["exported_lauf_end_zeitpunkt", dto.meta.exported_lauf_end_zeitpunkt],
    ["export_at", dto.meta.export_at],
    ["exporting_kasse_id", dto.meta.exporting_kasse_id],
    ["exporting_kasse_name", dto.meta.exporting_kasse_name],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["key", "value"], ...metaRows]), SHEET_META);

  const kassenHeader = ["id", "name", "is_master", "ws_url"];
  const kassenRows = dto.kassen.map((k) => [k.id, k.name, k.is_master, k.ws_url]);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([kassenHeader, ...kassenRows]),
    SHEET_KASSEN
  );

  const kaHeader = [
    "id",
    "kassen_id",
    "person1_name",
    "person2_name",
    "zeitstempel",
    "belegnummer",
    "sequence",
    "abrechnungslauf_id",
  ];
  const kaRows = dto.kundenabrechnungen.map((ka) => [
    ka.id,
    ka.kassen_id,
    ka.person1_name,
    ka.person2_name,
    ka.zeitstempel,
    ka.belegnummer,
    ka.sequence,
    ka.abrechnungslauf_id,
  ]);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([kaHeader, ...kaRows]),
    SHEET_KUNDENABRECHNUNG
  );

  const bHeader = ["id", "kundenabrechnung_id", "haendlernummer", "betrag", "bezeichnung"];
  const bRows = dto.buchungen.map((b) => [b.id, b.kundenabrechnung_id, b.haendlernummer, b.betrag, b.bezeichnung]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([bHeader, ...bRows]), SHEET_BUCHUNGEN);

  const sHeader = ["id", "buchung_id", "kassen_id", "zeitstempel", "kundenabrechnung_id"];
  const sRows = dto.stornos.map((s) => [s.id, s.buchung_id, s.kassen_id, s.zeitstempel, s.kundenabrechnung_id]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([sHeader, ...sRows]), SHEET_STORNOS);

  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

function readSheetAoA(wb: XLSX.WorkBook, name: string): unknown[][] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: false }) as unknown[][];
}

function aoaToObjects(rows: unknown[][]): Record<string, unknown>[] {
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => asString(h).trim());
  const out: Record<string, unknown>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (r.every((c) => asString(c).trim() === "")) continue;
    const obj: Record<string, unknown> = {};
    for (let j = 0; j < header.length; j++) {
      obj[header[j]] = r[j];
    }
    out.push(obj);
  }
  return out;
}

export function parseEmergencyExcel(buffer: ArrayBuffer): NotfallExportDto {
  const wb = XLSX.read(buffer, { type: "array" });

  const metaAoA = readSheetAoA(wb, SHEET_META);
  const metaPairs = aoaToObjects(metaAoA);
  const metaMap = new Map<string, string | null>();
  for (const p of metaPairs) {
    const k = asString(p.key).trim();
    const v = asNullableString(p.value);
    if (k) metaMap.set(k, v);
  }

  const meta = {
    exported_lauf_id: asString(metaMap.get("exported_lauf_id") ?? ""),
    exported_lauf_name: asString(metaMap.get("exported_lauf_name") ?? ""),
    exported_lauf_start_zeitpunkt: asString(metaMap.get("exported_lauf_start_zeitpunkt") ?? ""),
    exported_lauf_end_zeitpunkt: metaMap.get("exported_lauf_end_zeitpunkt") ?? null,
    export_at: asString(metaMap.get("export_at") ?? ""),
    exporting_kasse_id: metaMap.get("exporting_kasse_id") ?? null,
    exporting_kasse_name: metaMap.get("exporting_kasse_name") ?? null,
  };

  const kassenObjs = aoaToObjects(readSheetAoA(wb, SHEET_KASSEN));
  const kassen = kassenObjs.map((o) => ({
    id: asString(o.id),
    name: asString(o.name),
    is_master: asNumber(o.is_master),
    ws_url: asNullableString(o.ws_url),
  }));

  const kaObjs = aoaToObjects(readSheetAoA(wb, SHEET_KUNDENABRECHNUNG));
  const kundenabrechnungen = kaObjs.map((o) => ({
    id: asString(o.id),
    kassen_id: asString(o.kassen_id),
    person1_name: asNullableString(o.person1_name),
    person2_name: asNullableString(o.person2_name),
    zeitstempel: asString(o.zeitstempel),
    belegnummer: asNullableString(o.belegnummer),
    sequence: asNumber(o.sequence),
    abrechnungslauf_id: asNullableString(o.abrechnungslauf_id),
  }));

  const bObjs = aoaToObjects(readSheetAoA(wb, SHEET_BUCHUNGEN));
  const buchungen = bObjs.map((o) => ({
    id: asString(o.id),
    kundenabrechnung_id: asString(o.kundenabrechnung_id),
    haendlernummer: asString(o.haendlernummer),
    betrag: asNumber(o.betrag),
    bezeichnung: asNullableString(o.bezeichnung),
  }));

  const sObjs = aoaToObjects(readSheetAoA(wb, SHEET_STORNOS));
  const stornos = sObjs.map((o) => ({
    id: asString(o.id),
    buchung_id: asString(o.buchung_id),
    kassen_id: asString(o.kassen_id),
    zeitstempel: asString(o.zeitstempel),
    kundenabrechnung_id: asNullableString(o.kundenabrechnung_id),
  }));

  if (!meta.exported_lauf_id || !meta.exported_lauf_name || !meta.exported_lauf_start_zeitpunkt) {
    throw new Error("Ungültiger Notfall-Export: META fehlt oder ist unvollständig.");
  }

  return { meta, kassen, kundenabrechnungen, buchungen, stornos };
}

function escapeCsvField(value: string): string {
  if (value.includes('"') || value.includes(";") || value.includes("\n") || value.includes("\r")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function parseCsv(content: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  function pushField() {
    row.push(field);
    field = "";
  }
  function pushRow() {
    out.push(row);
    row = [];
  }

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    const next = content[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ";") {
      pushField();
      continue;
    }
    if (c === "\n") {
      pushField();
      pushRow();
      continue;
    }
    if (c === "\r") {
      // ignore, handle with \n
      continue;
    }
    field += c;
  }
  pushField();
  pushRow();
  return out.filter((r) => r.some((x) => x.trim() !== ""));
}

export function buildEmergencyCsv(dto: NotfallExportDto): string {
  const lines: string[] = [];
  const header = [
    "record_type",
    "key",
    "value",
    "id",
    "name",
    "is_master",
    "ws_url",
    "kassen_id",
    "person1_name",
    "person2_name",
    "zeitstempel",
    "belegnummer",
    "sequence",
    "abrechnungslauf_id",
    "kundenabrechnung_id",
    "haendlernummer",
    "betrag",
    "bezeichnung",
    "buchung_id",
    "kundenabrechnung_id_optional",
  ];
  lines.push(header.join(";"));

  const add = (cells: (string | number | null | undefined)[]) => {
    lines.push(
      cells
        .map((c) => escapeCsvField(c == null ? "" : String(c)))
        .join(";")
    );
  };

  // META (key/value)
  add(["META", "exported_lauf_id", dto.meta.exported_lauf_id]);
  add(["META", "exported_lauf_name", dto.meta.exported_lauf_name]);
  add(["META", "exported_lauf_start_zeitpunkt", dto.meta.exported_lauf_start_zeitpunkt]);
  add(["META", "exported_lauf_end_zeitpunkt", dto.meta.exported_lauf_end_zeitpunkt ?? ""]);
  add(["META", "export_at", dto.meta.export_at]);
  add(["META", "exporting_kasse_id", dto.meta.exporting_kasse_id ?? ""]);
  add(["META", "exporting_kasse_name", dto.meta.exporting_kasse_name ?? ""]);

  for (const k of dto.kassen) {
    add(["KASSE", "", "", k.id, k.name, k.is_master, k.ws_url ?? ""]);
  }

  for (const ka of dto.kundenabrechnungen) {
    add([
      "KUNDENABRECHNUNG",
      "",
      "",
      ka.id,
      "",
      "",
      "",
      ka.kassen_id,
      ka.person1_name ?? "",
      ka.person2_name ?? "",
      ka.zeitstempel,
      ka.belegnummer ?? "",
      ka.sequence,
      ka.abrechnungslauf_id ?? "",
    ]);
  }

  for (const b of dto.buchungen) {
    add([
      "BUCHUNG",
      "",
      "",
      b.id,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      b.kundenabrechnung_id,
      b.haendlernummer,
      b.betrag,
      b.bezeichnung ?? "",
    ]);
  }

  for (const s of dto.stornos) {
    add([
      "STORNO",
      "",
      "",
      s.id,
      "",
      "",
      "",
      s.kassen_id,
      "",
      "",
      s.zeitstempel,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      s.buchung_id,
      s.kundenabrechnung_id ?? "",
    ]);
  }

  return lines.join("\r\n");
}

export function parseEmergencyCsv(content: string): NotfallExportDto {
  const rows = parseCsv(content.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("Ungültiger Notfall-CSV: keine Daten.");
  const header = rows[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const iRecord = idx("record_type");
  if (iRecord < 0) throw new Error("Ungültiger Notfall-CSV: Header fehlt.");

  const metaMap = new Map<string, string | null>();
  const kassen: NotfallExportDto["kassen"] = [];
  const kundenabrechnungen: NotfallExportDto["kundenabrechnungen"] = [];
  const buchungen: NotfallExportDto["buchungen"] = [];
  const stornos: NotfallExportDto["stornos"] = [];

  const get = (r: string[], name: string) => r[idx(name)] ?? "";

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const rt = (r[iRecord] ?? "").trim();
    if (!rt) continue;
    if (rt === "META") {
      const key = get(r, "key").trim();
      const value = asNullableString(get(r, "value"));
      if (key) metaMap.set(key, value);
      continue;
    }
    if (rt === "KASSE") {
      kassen.push({
        id: asString(get(r, "id")),
        name: asString(get(r, "name")),
        is_master: asNumber(get(r, "is_master")),
        ws_url: asNullableString(get(r, "ws_url")),
      });
      continue;
    }
    if (rt === "KUNDENABRECHNUNG") {
      kundenabrechnungen.push({
        id: asString(get(r, "id")),
        kassen_id: asString(get(r, "kassen_id")),
        person1_name: asNullableString(get(r, "person1_name")),
        person2_name: asNullableString(get(r, "person2_name")),
        zeitstempel: asString(get(r, "zeitstempel")),
        belegnummer: asNullableString(get(r, "belegnummer")),
        sequence: asNumber(get(r, "sequence")),
        abrechnungslauf_id: asNullableString(get(r, "abrechnungslauf_id")),
      });
      continue;
    }
    if (rt === "BUCHUNG") {
      buchungen.push({
        id: asString(get(r, "id")),
        kundenabrechnung_id: asString(get(r, "kundenabrechnung_id")),
        haendlernummer: asString(get(r, "haendlernummer")),
        betrag: asNumber(get(r, "betrag")),
        bezeichnung: asNullableString(get(r, "bezeichnung")),
      });
      continue;
    }
    if (rt === "STORNO") {
      stornos.push({
        id: asString(get(r, "id")),
        buchung_id: asString(get(r, "buchung_id")),
        kassen_id: asString(get(r, "kassen_id")),
        zeitstempel: asString(get(r, "zeitstempel")),
        kundenabrechnung_id: asNullableString(get(r, "kundenabrechnung_id_optional")),
      });
      continue;
    }
  }

  const meta = {
    exported_lauf_id: asString(metaMap.get("exported_lauf_id") ?? ""),
    exported_lauf_name: asString(metaMap.get("exported_lauf_name") ?? ""),
    exported_lauf_start_zeitpunkt: asString(metaMap.get("exported_lauf_start_zeitpunkt") ?? ""),
    exported_lauf_end_zeitpunkt: metaMap.get("exported_lauf_end_zeitpunkt") ?? null,
    export_at: asString(metaMap.get("export_at") ?? ""),
    exporting_kasse_id: metaMap.get("exporting_kasse_id") ?? null,
    exporting_kasse_name: metaMap.get("exporting_kasse_name") ?? null,
  };

  if (!meta.exported_lauf_id || !meta.exported_lauf_name || !meta.exported_lauf_start_zeitpunkt) {
    throw new Error("Ungültiger Notfall-CSV: META fehlt oder ist unvollständig.");
  }

  return { meta, kassen, kundenabrechnungen, buchungen, stornos };
}

