import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JoinAnfragenView from "./JoinAnfragenView";
import type { JoinRequestItem } from "../db";

vi.mock("../db", () => ({
  getJoinRequests: vi.fn(),
  approveJoinRequest: vi.fn(),
  rejectJoinRequest: vi.fn(),
}));

const { getJoinRequests, approveJoinRequest, rejectJoinRequest } = await import("../db");
const mockGetJoinRequests = vi.mocked(getJoinRequests);
const mockApproveJoinRequest = vi.mocked(approveJoinRequest);
const mockRejectJoinRequest = vi.mocked(rejectJoinRequest);

function mockRequest(overrides: Partial<JoinRequestItem> = {}): JoinRequestItem {
  return {
    id: "req-1",
    kassen_id: "kassen-abc",
    name: "Nebenkasse 1",
    my_ws_url: "ws://127.0.0.1:8766",
    status: "pending",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("JoinAnfragenView", () => {
  beforeEach(() => {
    mockGetJoinRequests.mockReset();
    mockApproveJoinRequest.mockReset();
    mockRejectJoinRequest.mockReset();
    mockGetJoinRequests.mockResolvedValue([]);
  });

  it("shows empty state and back button when no requests", async () => {
    render(<JoinAnfragenView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/Keine ausstehenden Anfragen/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Zurück/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Join-Anfragen/ })).toBeInTheDocument();
    expect(screen.getByText(/Join-Token eine Anfrage gesendet/)).toBeInTheDocument();
  });

  it("shows loading state while getJoinRequests is pending", async () => {
    let resolve: (value: JoinRequestItem[]) => void;
    mockGetJoinRequests.mockImplementation(
      () =>
        new Promise<JoinRequestItem[]>((r) => {
          resolve = r;
        })
    );

    render(<JoinAnfragenView onBack={() => {}} />);

    expect(screen.getByText(/Lade…/)).toBeInTheDocument();

    resolve!([]);
    await waitFor(() => {
      expect(screen.getByText(/Keine ausstehenden Anfragen/)).toBeInTheDocument();
    });
  });

  it("shows list with request name, id and action buttons", async () => {
    const req = mockRequest({ name: "Stand 2", kassen_id: "kassen-xyz" });
    mockGetJoinRequests.mockResolvedValue([req]);

    render(<JoinAnfragenView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Stand 2")).toBeInTheDocument();
    });
    expect(screen.getByText("kassen-xyz")).toBeInTheDocument();
    expect(screen.getByText(/Sync-URL: ws:\/\/127.0.0.1:8766/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Annehmen/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ablehnen/ })).toBeInTheDocument();
  });

  it("calls approveJoinRequest with kassen_id when Annehmen is clicked", async () => {
    const req = mockRequest({ kassen_id: "kassen-123" });
    mockGetJoinRequests.mockResolvedValue([req]);
    mockApproveJoinRequest.mockResolvedValue();

    render(<JoinAnfragenView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Annehmen/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Annehmen/ }));

    await waitFor(() => {
      expect(mockApproveJoinRequest).toHaveBeenCalledWith("kassen-123");
    });
  });

  it("calls rejectJoinRequest with kassen_id when Ablehnen is clicked", async () => {
    const req = mockRequest({ kassen_id: "kassen-456" });
    mockGetJoinRequests.mockResolvedValue([req]);
    mockRejectJoinRequest.mockResolvedValue();

    render(<JoinAnfragenView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Ablehnen/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Ablehnen/ }));

    await waitFor(() => {
      expect(mockRejectJoinRequest).toHaveBeenCalledWith("kassen-456");
    });
  });

  it("shows error message when approveJoinRequest rejects", async () => {
    const req = mockRequest();
    mockGetJoinRequests.mockResolvedValue([req]);
    mockApproveJoinRequest.mockRejectedValue(new Error("Server fehler"));

    render(<JoinAnfragenView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Annehmen/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Annehmen/ }));

    await waitFor(() => {
      expect(screen.getByText(/Server fehler/)).toBeInTheDocument();
    });
  });

  it("shows error message when rejectJoinRequest rejects", async () => {
    const req = mockRequest();
    mockGetJoinRequests.mockResolvedValue([req]);
    mockRejectJoinRequest.mockRejectedValue(new Error("Ablehnung fehlgeschlagen"));

    render(<JoinAnfragenView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Ablehnen/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Ablehnen/ }));

    await waitFor(() => {
      expect(screen.getByText(/Ablehnung fehlgeschlagen/)).toBeInTheDocument();
    });
  });

  it("calls onBack when Zurück is clicked", async () => {
    const onBack = vi.fn();
    render(<JoinAnfragenView onBack={onBack} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Zurück/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Zurück/ }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
