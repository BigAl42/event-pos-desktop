import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: vi.fn() } }));

const mockInvoke = vi.mocked(invoke);
const mockLoad = vi.mocked(Database.load);

describe("getAktivenAbrechnungslaufId", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockInvoke.mockReset();
  });

  it("returns id when one active run exists", async () => {
    mockInvoke.mockResolvedValue([
      {
        id: "lauf-1",
        name: "Lauf 1",
        start_zeitpunkt: "2025-01-01T00:00:00Z",
        end_zeitpunkt: null,
        is_aktiv: true,
      },
    ] as never);
    const { getAktivenAbrechnungslaufId } = await import("./db");
    const id = await getAktivenAbrechnungslaufId();
    expect(id).toBe("lauf-1");
    expect(mockInvoke).toHaveBeenCalledWith("get_abrechnungsläufe");
  });

  it("returns active id when multiple runs exist", async () => {
    mockInvoke.mockResolvedValue([
      { id: "inactive", name: "Alt", start_zeitpunkt: "", end_zeitpunkt: "", is_aktiv: false },
      { id: "active-id", name: "Aktiv", start_zeitpunkt: "", end_zeitpunkt: null, is_aktiv: true },
    ] as never);
    const { getAktivenAbrechnungslaufId } = await import("./db");
    const id = await getAktivenAbrechnungslaufId();
    expect(id).toBe("active-id");
  });

  it("throws when no active run exists", async () => {
    mockInvoke.mockResolvedValue([
      { id: "1", name: "L", start_zeitpunkt: "", end_zeitpunkt: "", is_aktiv: false },
    ] as never);
    const { getAktivenAbrechnungslaufId } = await import("./db");
    await expect(getAktivenAbrechnungslaufId()).rejects.toThrow(
      "Kein aktiver Abrechnungslauf vorhanden"
    );
  });

  it("throws when laufe array is empty", async () => {
    mockInvoke.mockResolvedValue([] as never);
    const { getAktivenAbrechnungslaufId } = await import("./db");
    await expect(getAktivenAbrechnungslaufId()).rejects.toThrow(
      "Kein aktiver Abrechnungslauf vorhanden"
    );
  });
});

describe("createKundenabrechnung", () => {
  let mockExecute: ReturnType<typeof vi.fn>;
  let mockSelect: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    mockInvoke.mockReset();
    mockLoad.mockReset();
    mockExecute = vi.fn().mockResolvedValue(undefined);
    let selectCallCount = 0;
    mockSelect = vi.fn().mockImplementation(() => {
      selectCallCount += 1;
      return Promise.resolve(selectCallCount === 1 ? [] : [{ max_seq: 0 }]);
    });
    mockInvoke
      .mockResolvedValueOnce("/tmp/test.db" as never) // init_db
      .mockResolvedValue([
        { id: "lauf-1", name: "L", start_zeitpunkt: "", end_zeitpunkt: null, is_aktiv: true },
      ] as never); // get_abrechnungslaeufe
    mockLoad.mockResolvedValue({
      path: "/tmp/test.db",
      close: vi.fn().mockResolvedValue(undefined),
      execute: mockExecute,
      select: mockSelect,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls execute with abrechnungslauf_id in kundenabrechnung INSERT", async () => {
    const { createKundenabrechnung } = await import("./db");
    await createKundenabrechnung("kassen-1", "A", "B", [
      { haendlernummer: "H1", betrag: 10.5 },
    ]);

    expect(mockExecute).toHaveBeenCalled();
    const insertKaCall = mockExecute.mock.calls.find(
      (c) =>
        String(c[0]).includes("INSERT INTO kundenabrechnung") &&
        String(c[0]).includes("abrechnungslauf_id")
    );
    expect(insertKaCall).toBeDefined();
    const args = insertKaCall![1] as unknown[];
    expect(args).toHaveLength(8);
    expect(args[7]).toBe("lauf-1");
  });

  it("calls execute for buchungen INSERT", async () => {
    const { createKundenabrechnung } = await import("./db");
    await createKundenabrechnung("kassen-1", "A", "B", [
      { haendlernummer: "H1", betrag: 10.5, bezeichnung: "Test" },
    ]);

    const buchungCalls = mockExecute.mock.calls.filter((c) =>
      String(c[0]).includes("INSERT INTO buchungen")
    );
    expect(buchungCalls.length).toBe(1);
    expect(buchungCalls[0][1][2]).toBe("H1");
    expect(buchungCalls[0][1][3]).toBe(10.5);
    expect(buchungCalls[0][1][4]).toBe("Test");
  });
});

describe("isInitializedFromMaster", () => {
  let mockExecute: ReturnType<typeof vi.fn>;
  let mockSelect: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    mockInvoke.mockReset();
    mockLoad.mockReset();
    mockExecute = vi.fn().mockResolvedValue(undefined);
    mockSelect = vi.fn().mockResolvedValue([]);
    mockInvoke.mockResolvedValue("/tmp/test.db" as never);
    mockLoad.mockResolvedValue({
      path: "/tmp/test.db",
      close: vi.fn().mockResolvedValue(undefined),
      execute: mockExecute,
      select: mockSelect,
    });
  });

  it("returns true when initialized_from_master is true", async () => {
    mockSelect.mockResolvedValue([{ value: "true" }]);
    const { isInitializedFromMaster } = await import("./db");
    const result = await isInitializedFromMaster();
    expect(result).toBe(true);
  });

  it("returns false when initialized_from_master is false", async () => {
    mockSelect.mockResolvedValue([{ value: "false" }]);
    const { isInitializedFromMaster } = await import("./db");
    const result = await isInitializedFromMaster();
    expect(result).toBe(false);
  });

  it("returns true and sets flag when role is master", async () => {
    mockSelect
      .mockResolvedValueOnce([]) // initialized_from_master
      .mockResolvedValueOnce([{ value: "master" }]); // role
    const { isInitializedFromMaster } = await import("./db");
    const result = await isInitializedFromMaster();
    expect(result).toBe(true);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("config"),
      expect.arrayContaining(["initialized_from_master", "true"])
    );
  });

  it("returns false when no flag and role is slave without master_ws_url", async () => {
    mockSelect
      .mockResolvedValueOnce([]) // initialized_from_master
      .mockResolvedValueOnce([{ value: "slave" }]) // role
      .mockResolvedValueOnce([]); // master_ws_url
    const { isInitializedFromMaster } = await import("./db");
    const result = await isInitializedFromMaster();
    expect(result).toBe(false);
  });
});

describe("hasKasse", () => {
  let mockSelect: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    mockInvoke.mockReset();
    mockLoad.mockReset();
    mockSelect = vi.fn().mockResolvedValue([]);
    mockInvoke.mockResolvedValue("/tmp/test.db" as never);
    mockLoad.mockResolvedValue({
      path: "/tmp/test.db",
      close: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue(undefined),
      select: mockSelect,
    });
  });

  it("returns true when kassen_id is set", async () => {
    mockSelect.mockResolvedValue([{ value: "kassen-uuid-1" }]);
    const { hasKasse } = await import("./db");
    const result = await hasKasse();
    expect(result).toBe(true);
  });

  it("returns false when kassen_id is not set", async () => {
    mockSelect.mockResolvedValue([]);
    const { hasKasse } = await import("./db");
    const result = await hasKasse();
    expect(result).toBe(false);
  });
});

describe("getAbrechnung", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockInvoke.mockReset();
  });

  it("returns mapped rows from get_haendler_umsatz", async () => {
    mockInvoke.mockResolvedValue([
      { haendlernummer: "H1", summe: 100.5, anzahl: 3 },
      { haendlernummer: "H2", summe: 50, anzahl: 1 },
    ] as never);
    const { getAbrechnung } = await import("./db");
    const rows = await getAbrechnung();
    expect(mockInvoke).toHaveBeenCalledWith("get_haendler_umsatz");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ haendlernummer: "H1", summe: 100.5, anzahl: 3 });
    expect(rows[1]).toEqual({ haendlernummer: "H2", summe: 50, anzahl: 1 });
  });

  it("returns empty array when backend returns empty", async () => {
    mockInvoke.mockResolvedValue([] as never);
    const { getAbrechnung } = await import("./db");
    const rows = await getAbrechnung();
    expect(rows).toEqual([]);
  });
});
