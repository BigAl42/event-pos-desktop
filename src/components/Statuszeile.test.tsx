import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Statuszeile from "./Statuszeile";

let mockRole: string | null = "master";
let mockIsConnected = true;
let mockStatusText = "Verbunden";

vi.mock("../db", () => ({
  getConfig: vi.fn(),
  getJoinRequests: vi.fn(),
  getAbrechnungsläufe: vi.fn(),
}));

vi.mock("../SyncStatusContext", () => ({
  useSyncStatus: () => ({
    role: mockRole,
    isConnected: mockIsConnected,
    statusText: mockStatusText,
  }),
}));

vi.mock("../SyncDataContext", () => ({
  useSyncData: () => ({ syncDataVersion: 0 }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

const { getConfig, getJoinRequests, getAbrechnungsläufe } = await import("../db");
const mockGetConfig = vi.mocked(getConfig);
const mockGetJoinRequests = vi.mocked(getJoinRequests);
const mockGetAbrechnungsläufe = vi.mocked(getAbrechnungsläufe);

describe("Statuszeile", () => {
  beforeEach(() => {
    mockRole = "master";
    mockIsConnected = true;
    mockStatusText = "Verbunden";
    mockGetConfig.mockResolvedValue(null);
    mockGetJoinRequests.mockResolvedValue([]);
    mockGetAbrechnungsläufe.mockResolvedValue([]);
  });

  it("renders null when role is not master or slave", () => {
    mockRole = null;
    const { container } = render(<Statuszeile />);
    expect(container.firstChild).toBeNull();
  });

  it("renders null when role is unknown", () => {
    mockRole = "unknown";
    const { container } = render(<Statuszeile />);
    expect(container.firstChild).toBeNull();
  });

  it("shows master label, kassenname, status and lauf when role is master", async () => {
    mockRole = "master";
    mockGetConfig.mockResolvedValue("Hauptkasse-Stand1");
    mockGetAbrechnungsläufe.mockResolvedValue([
      { id: "l1", name: "Lauf 2026", start_zeitpunkt: "", end_zeitpunkt: null, is_aktiv: true },
    ]);

    render(<Statuszeile />);

    await waitFor(() => {
      expect(screen.getByText(/Hauptkasse/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Hauptkasse-Stand1/)).toBeInTheDocument();
    expect(screen.getByText(/Verbunden/)).toBeInTheDocument();
    expect(screen.getByText(/Aktueller Abrechnungslauf:/)).toBeInTheDocument();
    expect(screen.getByText(/Lauf 2026/)).toBeInTheDocument();
  });

  it("shows slave label when role is slave", async () => {
    mockRole = "slave";
    mockGetConfig.mockResolvedValue("Nebenkasse 2");
    mockGetAbrechnungsläufe.mockResolvedValue([]);

    render(<Statuszeile />);

    await waitFor(() => {
      expect(screen.getByText(/Nebenkasse/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Nebenkasse 2/)).toBeInTheDocument();
  });

  it("does not show Aktueller Abrechnungslauf when no active lauf", async () => {
    mockRole = "master";
    mockGetAbrechnungsläufe.mockResolvedValue([]);

    render(<Statuszeile />);

    await waitFor(() => {
      expect(screen.getByText(/Verbunden/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Aktueller Abrechnungslauf/)).not.toBeInTheDocument();
  });

  it("shows join button when master has pending requests and onOpenJoinAnfragen provided", async () => {
    mockRole = "master";
    mockGetJoinRequests.mockResolvedValue([
      {
        id: "1",
        kassen_id: "k1",
        name: "K1",
        my_ws_url: null,
        cert_fingerprint: null,
        status: "pending",
        created_at: "",
      },
      {
        id: "2",
        kassen_id: "k2",
        name: "K2",
        my_ws_url: null,
        cert_fingerprint: null,
        status: "pending",
        created_at: "",
      },
    ]);

    const onOpenJoinAnfragen = vi.fn();
    render(<Statuszeile onOpenJoinAnfragen={onOpenJoinAnfragen} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /2 Join-Anfrage.*ausstehend/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /2 Join-Anfrage.*ausstehend/ }));
    expect(onOpenJoinAnfragen).toHaveBeenCalledTimes(1);
  });

  it("shows singular Join-Anfrage when one pending request", async () => {
    mockRole = "master";
    mockGetJoinRequests.mockResolvedValue([
      { id: "1", kassen_id: "k1", name: "K1", my_ws_url: null, cert_fingerprint: null, status: "pending", created_at: "" },
    ]);

    render(<Statuszeile onOpenJoinAnfragen={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /1 Join-Anfrage.*ausstehend/ })).toBeInTheDocument();
    });
  });

  it("does not show join button when onOpenJoinAnfragen is not provided", async () => {
    mockRole = "master";
    mockGetJoinRequests.mockResolvedValue([
      { id: "1", kassen_id: "k1", name: "K1", my_ws_url: null, cert_fingerprint: null, status: "pending", created_at: "" },
    ]);

    render(<Statuszeile />);

    await waitFor(() => {
      expect(screen.getByText(/Verbunden/)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Join-Anfrage/ })).not.toBeInTheDocument();
  });
});
