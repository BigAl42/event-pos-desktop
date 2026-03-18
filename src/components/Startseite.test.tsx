import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Startseite from "./Startseite";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("../db", () => ({
  getConfig: vi.fn(),
  getAbrechnungsläufe: vi.fn(),
  getJoinRequests: vi.fn().mockResolvedValue([]),
  removePeerFromNetwork: vi.fn(),
  discoverMasters: vi.fn().mockResolvedValue([]),
  setConfig: vi.fn(),
  joinNetwork: vi.fn(),
  startSyncConnections: vi.fn(),
}));

vi.mock("../SyncStatusContext", () => ({
  useSyncStatus: () => ({
    entries: [],
    isConnected: true,
    syncError: null,
    notConfigured: false,
    refresh: vi.fn(),
  }),
}));

const { getConfig, getAbrechnungsläufe } = await import("../db");
const mockGetConfig = vi.mocked(getConfig);
const mockGetAbrechnungsläufe = vi.mocked(getAbrechnungsläufe);

describe("Startseite (Slave Closeout)", () => {
  beforeEach(() => {
    mockGetConfig.mockReset();
    mockGetAbrechnungsläufe.mockReset();
  });

  it("shows closeout section for slave with status 'nicht angefragt' when no closeout_ok_at", async () => {
    mockGetConfig.mockImplementation(async (key: string) => {
      if (key === "role") return "slave";
      if (key === "closeout_ok_for_lauf_id") return "";
      if (key === "closeout_ok_at") return "";
      return null;
    });
    mockGetAbrechnungsläufe.mockResolvedValue([
      { id: "lauf1", name: "Aktiver Lauf", start_zeitpunkt: "", end_zeitpunkt: null, is_aktiv: true },
    ]);

    render(
      <Startseite
        onOpenKasse={() => {}}
        onOpenAbrechnung={() => {}}
        onOpenEinstellungen={() => {}}
      />
    );

    expect(await screen.findByRole("heading", { name: /Abmelden \(Lauf fertig\)/i })).toBeInTheDocument();
    expect(await screen.findByText(/^nicht angefragt$/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Aktiver Lauf:/i)).toBeInTheDocument();
    });
  });

  it("shows closeout timestamp and warns when closeout not for active lauf", async () => {
    const ts = new Date("2026-01-01T10:00:00.000Z").toISOString();
    mockGetConfig.mockImplementation(async (key: string) => {
      if (key === "role") return "slave";
      if (key === "closeout_ok_for_lauf_id") return "lauf-old";
      if (key === "closeout_ok_at") return ts;
      return null;
    });
    mockGetAbrechnungsläufe.mockResolvedValue([
      { id: "lauf-active", name: "Aktiv", start_zeitpunkt: "", end_zeitpunkt: null, is_aktiv: true },
    ]);

    render(
      <Startseite
        onOpenKasse={() => {}}
        onOpenAbrechnung={() => {}}
        onOpenEinstellungen={() => {}}
      />
    );

    expect(await screen.findByText(/OK seit/i)).toBeInTheDocument();
    expect(screen.getByText(/\(nicht für aktiven Lauf\)/i)).toBeInTheDocument();
  });
});

