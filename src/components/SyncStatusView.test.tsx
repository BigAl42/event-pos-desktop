import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncStatusEntry } from "../db";
import SyncStatusView from "./SyncStatusView";

let mockEntries: SyncStatusEntry[] = [];

vi.mock("../db", () => ({
  discoverMasters: vi.fn().mockResolvedValue([]),
  getAbrechnungsläufe: vi.fn(),
  getConfig: vi.fn(),
  getSyncRuntimeStatus: vi.fn().mockResolvedValue({ started: true, connected_peers: 1, started_at: null }),
  removePeerFromNetwork: vi.fn(),
}));

vi.mock("../SyncStatusContext", () => ({
  useSyncStatus: () => ({
    entries: mockEntries,
    refresh: vi.fn(),
    lastRefreshAt: null,
    pollMs: 5000,
  }),
}));

const { getAbrechnungsläufe, getConfig } = await import("../db");
const mockGetAbrechnungsläufe = vi.mocked(getAbrechnungsläufe);
const mockGetConfig = vi.mocked(getConfig);

describe("SyncStatusView", () => {
  beforeEach(() => {
    mockGetAbrechnungsläufe.mockReset();
    mockGetConfig.mockReset();
    mockEntries = [
      {
        peer_id: "peer1",
        name: "Peer 1",
        ws_url: "ws://peer",
        connected: true,
        last_sync: null,
        closeout_ok_for_lauf_id: "lauf-old",
        closeout_ok_at: new Date("2026-01-01T10:00:00.000Z").toISOString(),
      },
    ];
  });

  it("shows 'Closeout alt' when closeout is not for active lauf", async () => {
    mockGetConfig.mockResolvedValue("master");
    mockGetAbrechnungsläufe.mockResolvedValue([
      { id: "lauf-active", name: "Aktiv", start_zeitpunkt: "", end_zeitpunkt: null, is_aktiv: true },
    ]);
    render(<SyncStatusView onBack={() => {}} />);
    expect(await screen.findByText(/Closeout alt/i)).toBeInTheDocument();
  });

  it("shows 'Closeout OK' when closeout is for active lauf", async () => {
    mockEntries = [
      {
        peer_id: "peer1",
        name: "Peer 1",
        ws_url: "ws://peer",
        connected: true,
        last_sync: null,
        closeout_ok_for_lauf_id: "lauf-active",
        closeout_ok_at: new Date("2026-01-01T10:00:00.000Z").toISOString(),
      },
    ];
    mockGetConfig.mockResolvedValue("master");
    mockGetAbrechnungsläufe.mockResolvedValue([
      { id: "lauf-active", name: "Aktiv", start_zeitpunkt: "", end_zeitpunkt: null, is_aktiv: true },
    ]);
    render(<SyncStatusView onBack={() => {}} />);
    expect(await screen.findByText(/^Closeout OK$/i)).toBeInTheDocument();
  });
});

