import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncStatusEntry } from "../db";
import SyncStatusView from "./SyncStatusView";

let mockEntries: SyncStatusEntry[] = [];

vi.mock("../db", () => ({
  discoverMasters: vi.fn().mockResolvedValue([]),
  getAbrechnungsläufe: vi.fn(),
  getConfig: vi.fn(),
  getSyncRuntimeStatus: vi.fn(),
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

const { getAbrechnungsläufe, getConfig, getSyncRuntimeStatus } = await import("../db");
const mockGetAbrechnungsläufe = vi.mocked(getAbrechnungsläufe);
const mockGetConfig = vi.mocked(getConfig);
const mockGetSyncRuntimeStatus = vi.mocked(getSyncRuntimeStatus);

describe("SyncStatusView", () => {
  beforeEach(() => {
    mockGetAbrechnungsläufe.mockReset();
    mockGetConfig.mockReset();
    mockGetSyncRuntimeStatus.mockReset();
    mockGetSyncRuntimeStatus.mockResolvedValue({
      started: true,
      connected_peers: 1,
      started_at: null,
      local_cert_fingerprint: null,
    });
    mockEntries = [
      {
        peer_id: "peer1",
        name: "Peer 1",
        ws_url: "wss://peer",
        connected: true,
        last_sync: null,
        closeout_ok_for_lauf_id: "lauf-old",
        closeout_ok_at: new Date("2026-01-01T10:00:00.000Z").toISOString(),
        pinned_fingerprint: "aa11bb22cc",
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
        ws_url: "wss://peer",
        connected: true,
        last_sync: null,
        closeout_ok_for_lauf_id: "lauf-active",
        closeout_ok_at: new Date("2026-01-01T10:00:00.000Z").toISOString(),
        pinned_fingerprint: null,
      },
    ];
    mockGetConfig.mockResolvedValue("master");
    mockGetAbrechnungsläufe.mockResolvedValue([
      { id: "lauf-active", name: "Aktiv", start_zeitpunkt: "", end_zeitpunkt: null, is_aktiv: true },
    ]);
    render(<SyncStatusView onBack={() => {}} />);
    expect(await screen.findByText(/^Closeout OK$/i)).toBeInTheDocument();
  });

  it("shows TLS confidentiality line and pinned fingerprint for WSS peer", async () => {
    mockGetConfig.mockResolvedValue("slave");
    mockGetAbrechnungsläufe.mockResolvedValue([]);
    render(<SyncStatusView onBack={() => {}} />);
    expect(
      await screen.findByText(/Verschlüsselt \(TLS\/WSS\), Verbindung aktiv/i)
    ).toBeInTheDocument();
    expect(screen.getByText("aa11bb22cc")).toBeInTheDocument();
  });

  it("shows unencrypted label for ws:// URL", async () => {
    mockEntries = [
      {
        peer_id: "p2",
        name: "Legacy",
        ws_url: "ws://old:8765",
        connected: false,
        last_sync: null,
        pinned_fingerprint: null,
      },
    ];
    mockGetConfig.mockResolvedValue("slave");
    mockGetAbrechnungsläufe.mockResolvedValue([]);
    render(<SyncStatusView onBack={() => {}} />);
    expect(await screen.findByText(/Nicht verschlüsselt \(ws:\/\/\)/i)).toBeInTheDocument();
  });

  it("shows local TLS identity fingerprint from runtime when present", async () => {
    mockGetSyncRuntimeStatus.mockResolvedValue({
      started: false,
      connected_peers: 0,
      started_at: null,
      local_cert_fingerprint: "local-fp-hex-test",
    });
    mockGetConfig.mockResolvedValue("slave");
    mockGetAbrechnungsläufe.mockResolvedValue([]);
    render(<SyncStatusView onBack={() => {}} />);
    expect(await screen.findByText(/Diese Kasse \(TLS-Identität\)/i)).toBeInTheDocument();
    expect(screen.getByText("local-fp-hex-test")).toBeInTheDocument();
  });

  it("shows mDNS hint about WSS and peer fingerprint", async () => {
    mockGetConfig.mockResolvedValue("slave");
    mockGetAbrechnungsläufe.mockResolvedValue([]);
    render(<SyncStatusView onBack={() => {}} />);
    expect(
      await screen.findByText(/Gefundene Adressen nutzen WSS \(TLS\)/i)
    ).toBeInTheDocument();
  });
});

