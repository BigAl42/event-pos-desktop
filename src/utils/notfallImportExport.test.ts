import { describe, expect, it } from "vitest";
import type { NotfallExportDto } from "../db";
import { buildNotfallCsv, buildNotfallExcel, parseNotfallCsv, parseNotfallExcel } from "./notfallImportExport";

function sampleDto(): NotfallExportDto {
  return {
    meta: {
      exported_lauf_id: "lauf-1",
      exported_lauf_name: 'Event "Test"; 2026',
      exported_lauf_start_zeitpunkt: "2026-03-18T10:00:00.000Z",
      exported_lauf_end_zeitpunkt: null,
      export_at: "2026-03-18T11:00:00.000Z",
      exporting_kasse_id: "kasse-a",
      exporting_kasse_name: "Kasse A",
    },
    kassen: [{ id: "kasse-a", name: "Kasse A", is_master: 1, ws_url: "ws://127.0.0.1:8765" }],
    kundenabrechnungen: [
      {
        id: "ka-1",
        kassen_id: "kasse-a",
        person1_name: "Max",
        person2_name: null,
        zeitstempel: "2026-03-18T10:05:00.000Z",
        belegnummer: "BELEG-2026-001",
        sequence: 1,
        abrechnungslauf_id: "lauf-1",
      },
    ],
    buchungen: [
      {
        id: "b-1",
        kundenabrechnung_id: "ka-1",
        haendlernummer: "H1",
        betrag: 10.5,
        bezeichnung: 'Test "A";B',
      },
    ],
    stornos: [
      {
        id: "s-1",
        buchung_id: "b-1",
        kassen_id: "kasse-a",
        zeitstempel: "2026-03-18T10:06:00.000Z",
        kundenabrechnung_id: "ka-1",
      },
    ],
  };
}

describe("Notfall Excel", () => {
  it("roundtrips via XLSX", () => {
    const dto = sampleDto();
    const buffer = buildNotfallExcel(dto);
    const parsed = parseNotfallExcel(buffer);

    expect(parsed.meta.exported_lauf_id).toBe(dto.meta.exported_lauf_id);
    expect(parsed.meta.exported_lauf_name).toBe(dto.meta.exported_lauf_name);
    expect(parsed.kassen).toEqual(dto.kassen);
    expect(parsed.kundenabrechnungen).toEqual(dto.kundenabrechnungen);
    expect(parsed.buchungen).toEqual(dto.buchungen);
    expect(parsed.stornos).toEqual(dto.stornos);
  });
});

describe("Notfall CSV", () => {
  it("roundtrips via CSV and preserves quoting", () => {
    const dto = sampleDto();
    const csv = buildNotfallCsv(dto);
    expect(csv).toContain("record_type;");
    expect(csv).toContain('"Event ""Test""; 2026"');
    expect(csv).toContain('"Test ""A"";B"');

    const parsed = parseNotfallCsv(csv);
    expect(parsed.meta.exported_lauf_id).toBe(dto.meta.exported_lauf_id);
    expect(parsed.kassen).toEqual(dto.kassen);
    expect(parsed.kundenabrechnungen).toEqual(dto.kundenabrechnungen);
    expect(parsed.buchungen).toEqual(dto.buchungen);
    expect(parsed.stornos).toEqual(dto.stornos);
  });
});

