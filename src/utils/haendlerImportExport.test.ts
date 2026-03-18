import { describe, expect, it } from "vitest";
import type { HaendlerItem } from "../db";
import {
  exportHaendlerCsv,
  exportHaendlerExcel,
  haendlerToRow,
  normalizeNummer,
  parseCsv,
  parseExcel,
} from "./haendlerImportExport";

describe("haendlerToRow", () => {
  it("maps HaendlerItem to HaendlerRow", () => {
    const h: HaendlerItem = {
      haendlernummer: "42",
      name: "Test Händler",
      sort: 1,
      vorname: "Max",
      nachname: "Muster",
      strasse: "Hauptstr.",
      hausnummer: "1",
      plz: "12345",
      stadt: "Berlin",
      email: "max@example.com",
    };
    const row = haendlerToRow(h);
    expect(row).toEqual({
      nummer: "42",
      vorname: "Max",
      nachname: "Muster",
      strasse: "Hauptstr.",
      hausnummer: "1",
      plz: "12345",
      stadt: "Berlin",
      name: "Test Händler",
      sort: "1",
      email: "max@example.com",
    });
  });

  it("handles null/undefined with empty string", () => {
    const h: HaendlerItem = {
      haendlernummer: "1",
      name: "Nur Name",
      sort: null,
    };
    const row = haendlerToRow(h);
    expect(row.nummer).toBe("1");
    expect(row.name).toBe("Nur Name");
    expect(row.sort).toBe("");
    expect(row.vorname).toBe("");
    expect(row.plz).toBe("");
  });
});

describe("exportHaendlerCsv", () => {
  it("exports header and one row", () => {
    const list: HaendlerItem[] = [
      { haendlernummer: "1", name: "A", sort: null },
    ];
    const csv = exportHaendlerCsv(list);
    expect(csv).toContain("Nummer,Vorname,Nachname,");
    expect(csv).toContain("1,,,,");
    expect(csv.split("\r\n").length).toBe(2);
  });

  it("escapes fields with comma and quotes", () => {
    const list: HaendlerItem[] = [
      {
        haendlernummer: "1",
        name: 'Firma "AG"',
        sort: null,
        strasse: "Str. 1, EG",
      },
    ];
    const csv = exportHaendlerCsv(list);
    expect(csv).toContain('"Firma ""AG"""');
    expect(csv).toContain('"Str. 1, EG"');
  });

  it("exports multiple rows", () => {
    const list: HaendlerItem[] = [
      { haendlernummer: "1", name: "A", sort: null },
      { haendlernummer: "2", name: "B", sort: null },
    ];
    const csv = exportHaendlerCsv(list);
    const lines = csv.split("\r\n");
    expect(lines.length).toBe(3);
    expect(lines[1]).toContain("1");
    expect(lines[2]).toContain("2");
  });
});

describe("parseCsv", () => {
  it("parses CSV with header", () => {
    const content = "Nummer,Vorname,Nachname,Straße,Hausnummer,PLZ,Stadt,Name,Sortierung,E-Mail\n1,Max,Muster,Hauptstr.,1,12345,Berlin,Test,1,max@example.com";
    const rows = parseCsv(content);
    expect(rows.length).toBe(1);
    expect(rows[0].nummer).toBe("1");
    expect(rows[0].vorname).toBe("Max");
    expect(rows[0].name).toBe("Test");
    expect(rows[0].email).toBe("max@example.com");
  });

  it("parses CSV without header when first cell is numeric", () => {
    const content = "1,Max,Muster,Hauptstr.,1,12345,Berlin,Test,1,max@example.com";
    const rows = parseCsv(content);
    expect(rows.length).toBe(1);
    expect(rows[0].nummer).toBe("1");
    expect(rows[0].name).toBe("Test");
    expect(rows[0].email).toBe("max@example.com");
  });

  it("handles escaped quotes in CSV", () => {
    const content = 'Nummer,Vorname,Nachname,Straße,Hausnummer,PLZ,Stadt,Name,Sortierung\n1,"Max ""M""",Muster,,,,,';
    const rows = parseCsv(content);
    expect(rows.length).toBe(1);
    expect(rows[0].vorname).toBe('Max "M"');
  });

  it("skips empty lines and rows without nummer", () => {
    const content = "Nummer,Vorname,Nachname,Straße,Hausnummer,PLZ,Stadt,Name,Sortierung,E-Mail\n1,A,,,,,,,\n\n  \n2,B,,,,,,,";
    const rows = parseCsv(content);
    expect(rows.length).toBe(2);
    expect(rows[0].nummer).toBe("1");
    expect(rows[1].nummer).toBe("2");
  });

  it("returns empty array for empty content", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("   \n  ")).toEqual([]);
  });
});

describe("parseExcel", () => {
  it("roundtrips with exportHaendlerExcel", () => {
    const list: HaendlerItem[] = [
      {
        haendlernummer: "10",
        name: "Excel Händler",
        sort: 2,
        vorname: "E",
        nachname: "X",
        plz: "99999",
        stadt: "München",
        email: "excel@example.com",
      },
    ];
    const buffer = exportHaendlerExcel(list);
    const rows = parseExcel(buffer);
    expect(rows.length).toBe(1);
    expect(rows[0].nummer).toBe("10");
    expect(rows[0].name).toBe("Excel Händler");
    expect(rows[0].vorname).toBe("E");
    expect(rows[0].stadt).toBe("München");
    expect(rows[0].email).toBe("excel@example.com");
  });

  it("returns empty array for empty sheet", () => {
    const list: HaendlerItem[] = [];
    const buffer = exportHaendlerExcel(list);
    const rows = parseExcel(buffer);
    expect(rows).toEqual([]);
  });
});

describe("normalizeNummer", () => {
  it("trims and normalizes numeric string", () => {
    expect(normalizeNummer("  42  ")).toBe("42");
    expect(normalizeNummer("1")).toBe("1");
  });

  it("returns empty string for empty/whitespace", () => {
    expect(normalizeNummer("")).toBe("");
    expect(normalizeNummer("   ")).toBe("");
  });

  it("returns original trimmed if not a positive number", () => {
    expect(normalizeNummer("H1")).toBe("H1");
    expect(normalizeNummer("0")).toBe("0");
    expect(normalizeNummer("-1")).toBe("-1");
    expect(normalizeNummer("abc")).toBe("abc");
  });
});
