import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StatusBar from "./StatusBar";

let mockRole: string | null = "master";
let mockIsConnected = true;
let mockStatusText = "Connected to 1 of 1 registers";

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

describe("StatusBar", () => {
  beforeEach(() => {
    mockRole = "master";
    mockIsConnected = true;
    mockStatusText = "Connected to 1 of 1 registers";
    mockGetConfig.mockResolvedValue(null);
    mockGetJoinRequests.mockResolvedValue([]);
    mockGetAbrechnungsläufe.mockResolvedValue([]);
  });

  it("renders null when role is not master or slave", () => {
    mockRole = null;
    const { container } = render(<StatusBar />);
    expect(container.firstChild).toBeNull();
  });

  it("renders null when role is unknown", () => {
    mockRole = "unknown";
    const { container } = render(<StatusBar />);
    expect(container.firstChild).toBeNull();
  });

  it("shows master label, kassenname, status and lauf when role is master", async () => {
    mockRole = "master";
    mockGetConfig.mockResolvedValue("Hauptkasse-Stand1");
    mockGetAbrechnungsläufe.mockResolvedValue([
      { id: "l1", name: "Lauf 2026", start_zeitpunkt: "", end_zeitpunkt: null, is_aktiv: true },
    ]);

    render(<StatusBar />);

    await waitFor(() => {
      expect(screen.getByText(/Main register/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Hauptkasse-Stand1/)).toBeInTheDocument();
    expect(screen.getByText(/Connected to 1 of 1 registers/)).toBeInTheDocument();
    expect(screen.getByText(/Current billing cycle:/)).toBeInTheDocument();
    expect(screen.getByText(/Lauf 2026/)).toBeInTheDocument();
  });

  it("shows slave label when role is slave", async () => {
    mockRole = "slave";
    mockGetConfig.mockResolvedValue("Nebenkasse 2");
    mockGetAbrechnungsläufe.mockResolvedValue([]);

    render(<StatusBar />);

    await waitFor(() => {
      expect(screen.getByText(/Satellite register/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Nebenkasse 2/)).toBeInTheDocument();
  });

  it("does not show current billing cycle when no active lauf", async () => {
    mockRole = "master";
    mockGetAbrechnungsläufe.mockResolvedValue([]);

    render(<StatusBar />);

    await waitFor(() => {
      expect(screen.getByText(/Connected to 1 of 1 registers/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Current billing cycle:/)).not.toBeInTheDocument();
  });

  it("shows join button when master has pending requests and onOpenJoinRequests provided", async () => {
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

    const onOpenJoinRequests = vi.fn();
    render(<StatusBar onOpenJoinRequests={onOpenJoinRequests} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /2 join request\(s\) pending – open/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /2 join request\(s\) pending – open/i }),
    );
    expect(onOpenJoinRequests).toHaveBeenCalledTimes(1);
  });

  it("shows singular join request when one pending request", async () => {
    mockRole = "master";
    mockGetJoinRequests.mockResolvedValue([
      { id: "1", kassen_id: "k1", name: "K1", my_ws_url: null, cert_fingerprint: null, status: "pending", created_at: "" },
    ]);

    render(<StatusBar onOpenJoinRequests={() => {}} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /1 join request\(s\) pending – open/i }),
      ).toBeInTheDocument();
    });
  });

  it("does not show join button when onOpenJoinRequests is not provided", async () => {
    mockRole = "master";
    mockGetJoinRequests.mockResolvedValue([
      { id: "1", kassen_id: "k1", name: "K1", my_ws_url: null, cert_fingerprint: null, status: "pending", created_at: "" },
    ]);

    render(<StatusBar />);

    await waitFor(() => {
      expect(screen.getByText(/Connected to 1 of 1 registers/)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /join request/i })).not.toBeInTheDocument();
  });
});
