import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsView from "./SettingsView";

vi.mock("../db", () => ({
  getCurrentKasse: vi.fn(),
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  getJoinToken: vi.fn(),
  generateJoinToken: vi.fn(),
  updateKassenPersonen: vi.fn(),
  startMasterServer: vi.fn(),
  isMasterServerRunning: vi.fn(),
  joinNetwork: vi.fn(),
  startSyncConnections: vi.fn(),
  discoverMasters: vi.fn(),
  getAbrechnungsläufe: vi.fn(),
  createAbrechnungslauf: vi.fn(),
  deleteAbrechnungslauf: vi.fn(),
  requestSlaveReset: vi.fn(),
  wipeLocalData: vi.fn(),
}));

const {
  getCurrentKasse,
  getConfig,
  getJoinToken,
  updateKassenPersonen,
  isMasterServerRunning,
  getAbrechnungsläufe,
  wipeLocalData,
} = await import("../db");

const mockGetCurrentKasse = vi.mocked(getCurrentKasse);
const mockGetConfig = vi.mocked(getConfig);
vi.mocked(getJoinToken);
const mockUpdateKassenPersonen = vi.mocked(updateKassenPersonen);
vi.mocked(isMasterServerRunning);
vi.mocked(getAbrechnungsläufe);
const mockWipeLocalData = vi.mocked(wipeLocalData);

describe("SettingsView Danger Zone", () => {
  beforeEach(() => {
    mockGetCurrentKasse.mockResolvedValue({
      id: "k1",
      name: "Kasse 1",
      person1_name: "Alice",
      person2_name: "Bob",
      is_master: 1,
      created_at: new Date().toISOString(),
    });
    mockGetConfig.mockImplementation(async (key: string) => {
      if (key === "role") return "master";
      return null;
    });
    vi.mocked(getJoinToken).mockResolvedValue(null);
    vi.mocked(isMasterServerRunning).mockResolvedValue(false);
    vi.mocked(getAbrechnungsläufe).mockResolvedValue([]);
    mockWipeLocalData.mockResolvedValue();
    mockUpdateKassenPersonen.mockResolvedValue();

    Object.defineProperty(window, "location", {
      value: { reload: vi.fn() },
      writable: true,
    });
  });

  it("keeps wipe button disabled until DELETE is entered", async () => {
    render(<SettingsView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/Danger Zone/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Danger Zone/));

    const button = screen.getByRole("button", { name: /Alles lokal löschen/i });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Bestätigung/i), { target: { value: "DEL" } });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Bestätigung/i), { target: { value: "DELETE" } });
    expect(button).toBeEnabled();
  });

  it("calls wipeLocalData and reloads when confirmed", async () => {
    render(<SettingsView onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/Danger Zone/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Danger Zone/));

    fireEvent.change(screen.getByLabelText(/Bestätigung/i), { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: /Alles lokal löschen/i }));
    fireEvent.click(screen.getByRole("button", { name: /Ja, alles löschen/i }));

    await waitFor(() => {
      expect(mockWipeLocalData).toHaveBeenCalledTimes(1);
    });
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsView Besetzung", () => {
  beforeEach(() => {
    mockGetCurrentKasse.mockResolvedValue({
      id: "k1",
      name: "Kasse 1",
      person1_name: "Alice",
      person2_name: "Bob",
      is_master: 1,
      created_at: new Date().toISOString(),
    });
    mockGetConfig.mockImplementation(async (key: string) => {
      if (key === "role") return "master";
      return null;
    });
    vi.mocked(getJoinToken).mockResolvedValue(null);
    vi.mocked(isMasterServerRunning).mockResolvedValue(false);
    vi.mocked(getAbrechnungsläufe).mockResolvedValue([]);
    mockUpdateKassenPersonen.mockResolvedValue();
  });

  it("allows editing and saves Personen via updateKassenPersonen", async () => {
    render(<SettingsView onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/Diese Kasse/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Besetzung bearbeiten/i }));

    fireEvent.change(screen.getByLabelText(/^Person 1$/i), { target: { value: "Anna" } });
    fireEvent.change(screen.getByLabelText(/^Person 2$/i), { target: { value: "Ben" } });
    fireEvent.click(screen.getByRole("button", { name: /^Speichern$/i }));

    await waitFor(() => {
      expect(mockUpdateKassenPersonen).toHaveBeenCalledWith("k1", "Anna", "Ben");
    });
  });
});

