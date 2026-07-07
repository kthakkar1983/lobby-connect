import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
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
  timeZone: null as string | null,
  emergencyActive: false,
  emergencyFailed: false,
  onToggleMute: vi.fn(),
  onHangUp: vi.fn(),
  onTriggerEmergency: vi.fn(),
  onRoomNumberChange: vi.fn(),
  onNotesChange: vi.fn(),
  onSaveNotes: vi.fn().mockResolvedValue(true),
  captionFinals: [] as string[],
  captionPartial: "",
  captionsEnabled: true,
  onToggleCaptions: vi.fn(),
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

  it("shows hotel local time only when a timezone is provided", () => {
    const { rerender } = render(<AudioCallOverlay {...baseProps} timeZone={null} />);
    expect(screen.queryByText(/hotel local time/i)).toBeNull();
    rerender(<AudioCallOverlay {...baseProps} timeZone="America/New_York" />);
    expect(screen.getByText(/hotel local time/i)).toBeTruthy();
  });

  it("hides local time for an invalid timezone (no crash)", () => {
    render(<AudioCallOverlay {...baseProps} timeZone="Not/AZone" />);
    expect(screen.queryByText(/hotel local time/i)).toBeNull();
  });

  it("renders the caption band with the guest's words", () => {
    render(<AudioCallOverlay {...baseProps} captionFinals={["I need extra towels"]} captionPartial="" />);
    expect(screen.getByText(/I need extra towels/i)).toBeTruthy();
  });

  it("toggles captions from the control bar", async () => {
    const user = userEvent.setup();
    const onToggleCaptions = vi.fn();
    render(<AudioCallOverlay {...baseProps} onToggleCaptions={onToggleCaptions} />);
    await user.click(screen.getByRole("button", { name: /captions/i }));
    expect(onToggleCaptions).toHaveBeenCalledOnce();
  });

  it("saves notes on Enter and shows a saved indicator", async () => {
    const user = userEvent.setup();
    const onSaveNotes = vi.fn().mockResolvedValue(true);
    render(<AudioCallOverlay {...baseProps} notes="towels" onSaveNotes={onSaveNotes} />);
    await user.type(screen.getByPlaceholderText("Call notes"), "{Enter}");
    expect(onSaveNotes).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByText(/notes saved/i)).toBeTruthy());
  });

  // Phase E (Task 19b): the Connect control launches remote access for the
  // call's property; disabled when the caller has no propertyId to resolve
  // (e.g. the ringing call's propertyId Parameter was absent).
  it("calls onConnect from the Connect control when provided", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    render(<AudioCallOverlay {...baseProps} onConnect={onConnect} />);
    await user.click(screen.getByRole("button", { name: /connect/i }));
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it("disables the Connect control when onConnect is absent", () => {
    render(<AudioCallOverlay {...baseProps} />);
    expect(screen.getByRole("button", { name: /connect/i })).toHaveProperty("disabled", true);
  });
});
