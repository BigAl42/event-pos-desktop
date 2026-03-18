import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ErststartDialog from "./ErststartDialog";

vi.mock("../db", () => ({
  setupMaster: vi.fn(),
  setupSlave: vi.fn(),
}));

const { setupMaster, setupSlave } = await import("../db");
const mockSetupMaster = vi.mocked(setupMaster);
const mockSetupSlave = vi.mocked(setupSlave);

describe("ErststartDialog", () => {
  beforeEach(() => {
    mockSetupMaster.mockReset();
    mockSetupSlave.mockReset();
    mockSetupMaster.mockResolvedValue();
    mockSetupSlave.mockResolvedValue();
  });

  it("shows choice step with heading and both buttons", () => {
    render(<ErststartDialog onDone={() => {}} />);

    expect(screen.getByRole("heading", { name: /Kassensystem einrichten/ })).toBeInTheDocument();
    expect(screen.getByText(/Als was möchten Sie diese Kasse einrichten/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Als Hauptkasse/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Netz beitreten \(Nebenkasse\)/ })).toBeInTheDocument();
  });

  it("navigates to master form when clicking Als Hauptkasse", () => {
    render(<ErststartDialog onDone={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /Als Hauptkasse/ }));

    expect(screen.getByRole("heading", { name: /Hauptkasse einrichten/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/Kassenname/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Person 1/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Person 2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Zurück/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Als Hauptkasse einrichten/ })).toBeInTheDocument();
  });

  it("navigates to slave form when clicking Netz beitreten", () => {
    render(<ErststartDialog onDone={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /Netz beitreten \(Nebenkasse\)/ }));

    expect(screen.getByRole("heading", { name: /Netz beitreten/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Einrichtung abschließen/ })).toBeInTheDocument();
  });

  it("goes back to choice step when clicking Zurück in form", () => {
    render(<ErststartDialog onDone={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /Als Hauptkasse/ }));
    expect(screen.getByRole("heading", { name: /Hauptkasse einrichten/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Zurück/ }));

    expect(screen.getByRole("heading", { name: /Kassensystem einrichten/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Als Hauptkasse/ })).toBeInTheDocument();
  });

  it("shows error when submitting master form without Kassenname", async () => {
    render(<ErststartDialog onDone={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /Als Hauptkasse/ }));
    fireEvent.click(screen.getByRole("button", { name: /Als Hauptkasse einrichten/ }));

    expect(screen.getByText(/Bitte Kassenname angeben/)).toBeInTheDocument();
    expect(mockSetupMaster).not.toHaveBeenCalled();
  });

  it("calls setupMaster and onDone when master form is valid", async () => {
    const onDone = vi.fn();
    render(<ErststartDialog onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: /Als Hauptkasse/ }));
    fireEvent.change(screen.getByLabelText(/Kassenname/), { target: { value: "  Stand 1  " } });
    fireEvent.change(screen.getByLabelText(/Person 1/), { target: { value: "Alice" } });
    fireEvent.change(screen.getByLabelText(/Person 2/), { target: { value: "Bob" } });
    fireEvent.click(screen.getByRole("button", { name: /Als Hauptkasse einrichten/ }));

    await waitFor(() => {
      expect(mockSetupMaster).toHaveBeenCalledWith("Stand 1", "Alice", "Bob");
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("calls setupSlave and onDone when slave form is valid", async () => {
    const onDone = vi.fn();
    render(<ErststartDialog onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: /Netz beitreten \(Nebenkasse\)/ }));
    fireEvent.change(screen.getByLabelText(/Kassenname/), { target: { value: "Nebenkasse A" } });
    fireEvent.click(screen.getByRole("button", { name: /Einrichtung abschließen/ }));

    await waitFor(() => {
      expect(mockSetupSlave).toHaveBeenCalledWith("Nebenkasse A", "", "");
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("shows error and does not call onDone when setupMaster rejects", async () => {
    const onDone = vi.fn();
    mockSetupMaster.mockRejectedValue(new Error("DB fehler"));

    render(<ErststartDialog onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: /Als Hauptkasse/ }));
    fireEvent.change(screen.getByLabelText(/Kassenname/), { target: { value: "Stand 1" } });
    fireEvent.click(screen.getByRole("button", { name: /Als Hauptkasse einrichten/ }));

    await waitFor(() => {
      expect(screen.getByText(/DB fehler/)).toBeInTheDocument();
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it("shows error and does not call onDone when setupSlave rejects", async () => {
    const onDone = vi.fn();
    mockSetupSlave.mockRejectedValue(new Error("Netzwerk fehler"));

    render(<ErststartDialog onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: /Netz beitreten \(Nebenkasse\)/ }));
    fireEvent.change(screen.getByLabelText(/Kassenname/), { target: { value: "Slave" } });
    fireEvent.click(screen.getByRole("button", { name: /Einrichtung abschließen/ }));

    await waitFor(() => {
      expect(screen.getByText(/Netzwerk fehler/)).toBeInTheDocument();
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it("disables submit button and shows loading during async call", async () => {
    let resolve: () => void;
    mockSetupMaster.mockImplementation(() => new Promise<void>((r) => { resolve = r; }));

    render(<ErststartDialog onDone={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /Als Hauptkasse/ }));
    fireEvent.change(screen.getByLabelText(/Kassenname/), { target: { value: "Stand 1" } });
    fireEvent.click(screen.getByRole("button", { name: /Als Hauptkasse einrichten/ }));

    const submitBtn = screen.getByRole("button", { name: /…/ });
    expect(submitBtn).toBeDisabled();

    resolve!();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Als Hauptkasse einrichten/ })).toBeInTheDocument();
    });
  });
});
