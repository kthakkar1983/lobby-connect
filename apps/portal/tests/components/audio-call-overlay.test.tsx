import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/call/playbook-panel", () => ({
  PlaybookPanel: ({ callId }: { callId: string }) => (
    <div data-testid="playbook" data-call-id={callId} />
  ),
}));

import { AudioCallOverlay } from "@/components/softphone/audio-call-overlay";

const baseProps = {
  propertyName: "The Sample Hotel",
  callId: "call-42",
  muted: false,
  roomNumber: "",
  notes: "",
  emergencyActive: false,
  emergencyFailed: false,
  onToggleMute: vi.fn(),
  onHangUp: vi.fn(),
  onTriggerEmergency: vi.fn(),
  onRoomNumberChange: vi.fn(),
  onNotesChange: vi.fn(),
};

afterEach(() => cleanup());

describe("AudioCallOverlay", () => {
  it("shows the property name and the playbook (with the call id)", () => {
    render(<AudioCallOverlay {...baseProps} />);
    expect(screen.getByText(/On call · The Sample Hotel/i)).toBeTruthy();
    expect(screen.getByTestId("playbook").getAttribute("data-call-id")).toBe("call-42");
  });

  it("calls onToggleMute and onHangUp from the control bar", async () => {
    const user = userEvent.setup();
    const onToggleMute = vi.fn();
    const onHangUp = vi.fn();
    render(<AudioCallOverlay {...baseProps} onToggleMute={onToggleMute} onHangUp={onHangUp} />);
    await user.click(screen.getByText("Mute"));
    await user.click(screen.getByText("Hang up"));
    expect(onToggleMute).toHaveBeenCalledOnce();
    expect(onHangUp).toHaveBeenCalledOnce();
  });

  it("relays room-number edits via onRoomNumberChange", async () => {
    const user = userEvent.setup();
    const onRoomNumberChange = vi.fn();
    render(<AudioCallOverlay {...baseProps} onRoomNumberChange={onRoomNumberChange} />);
    await user.type(screen.getByPlaceholderText("Room #"), "5");
    expect(onRoomNumberChange).toHaveBeenCalledWith("5");
  });

  it("shows the emergency banner and locks the 911 button when active", () => {
    render(<AudioCallOverlay {...baseProps} emergencyActive />);
    expect(screen.getByText(/Emergency active/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /911 active/i })).toHaveProperty("disabled", true);
  });
});
