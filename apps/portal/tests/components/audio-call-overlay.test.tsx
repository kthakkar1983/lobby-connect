import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// `basis` is mirrored onto the stub so the body split is assertable — it is the
// overlay's, not the panel's, decision and Task 12 changes it.
vi.mock("@/components/call/playbook-panel", () => ({
  PlaybookPanel: ({ callId, basis }: { callId: string; basis?: string }) => (
    <div data-testid="playbook" data-call-id={callId} data-basis={basis} />
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
    await user.click(screen.getByText("End call"));
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
    // Task 14: onConnect now RESOLVES the launch outcome so this overlay can
    // say something when it fails. Presence/absence still means "is there a
    // property to connect to", exactly as before.
    const onConnect = vi.fn().mockResolvedValue({ launched: true });
    render(<AudioCallOverlay {...baseProps} onConnect={onConnect} />);
    await user.click(screen.getByRole("button", { name: /connect/i }));
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it("disables the Connect control when onConnect is absent", () => {
    render(<AudioCallOverlay {...baseProps} />);
    expect(screen.getByRole("button", { name: /connect/i })).toHaveProperty("disabled", true);
  });

  // Task 14: the tone is a DELIBERATE split (2026-07-10 batch-1 polish) — navy
  // on the property cards, teal on all three in-call Connects.
  // <PropertyActionButton> defaults to navy, so an omitted `tone="teal"` reverts
  // that polish with nothing to notice it.
  it("keeps the in-call Connect teal after the move onto PropertyActionButton", () => {
    render(<AudioCallOverlay {...baseProps} onConnect={vi.fn().mockResolvedValue({ launched: true })} />);
    expect(screen.getByRole("button", { name: /connect/i }).className).toContain("bg-accent");
  });

  // Spec §7's behavioural gap. This Connect called its handler and dropped the
  // result on the floor, so a failed remote-access launch was SILENT: the agent
  // pressed Connect during a live guest call, RustDesk never opened, and nothing
  // on screen distinguished "still coming" from "will never come".
  it("surfaces a failed remote-access launch instead of failing silently", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn().mockResolvedValue({ launched: false, notConfigured: true });
    render(<AudioCallOverlay {...baseProps} onConnect={onConnect} />);

    await user.click(screen.getByRole("button", { name: /connect/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("No remote access configured — ask an admin.");
  });

  it("clears a previous Connect failure once a later attempt launches", async () => {
    const user = userEvent.setup();
    const onConnect = vi
      .fn()
      .mockResolvedValueOnce({ launched: false, notConfigured: false })
      .mockResolvedValue({ launched: true });
    render(<AudioCallOverlay {...baseProps} onConnect={onConnect} />);

    const connect = screen.getByRole("button", { name: /connect/i });
    await user.click(connect);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not fetch credentials — try again.",
    );

    // A stale failure left on screen after a working retry reads as "still
    // broken" for the rest of the call.
    await user.click(connect);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  // A REJECTED onConnect would otherwise skip setConnectError entirely and
  // surface as an unhandled rejection — the exact silence this control exists
  // to end. It maps to the transient wording: an exception is not evidence the
  // property has no credentials configured.
  it("surfaces a thrown Connect as a retryable failure, not silence", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn().mockRejectedValue(new Error("boom"));
    render(<AudioCallOverlay {...baseProps} onConnect={onConnect} />);

    await user.click(screen.getByRole("button", { name: /connect/i }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not fetch credentials — try again.",
    );
  });

  // The control bar's geometry is fixed on purpose so it cannot move under her
  // hand mid-call; a flow error would grow it and lift End call and Mute the
  // moment one appeared. jsdom does no layout, so the mechanism is what is
  // pinned: out of flow.
  it("floats the Connect failure so it cannot resize the control bar mid-call", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn().mockResolvedValue({ launched: false, notConfigured: true });
    render(<AudioCallOverlay {...baseProps} onConnect={onConnect} />);

    await user.click(screen.getByRole("button", { name: /connect/i }));

    expect((await screen.findByRole("alert")).className).toContain("absolute");
  });

  it("saves notes on Tab as well as Enter (audio↔video parity)", async () => {
    const user = userEvent.setup();
    const onSaveNotes = vi.fn().mockResolvedValue(true);
    render(<AudioCallOverlay {...baseProps} notes="towels" onSaveNotes={onSaveNotes} />);
    await user.type(screen.getByPlaceholderText("Call notes"), "{Tab}");
    expect(onSaveNotes).toHaveBeenCalledOnce();
  });

  it("renders the Reopen tile control and fires onReopenTile when the tile was closed", async () => {
    const user = userEvent.setup();
    const onReopenTile = vi.fn();
    render(<AudioCallOverlay {...baseProps} showReopenTile onReopenTile={onReopenTile} />);
    await user.click(screen.getByRole("button", { name: /reopen tile/i }));
    expect(onReopenTile).toHaveBeenCalledOnce();
  });

  // Spec §6: video tucks this into the bottom-right corner of the guest stage;
  // audio has no stage to tuck it into, so it is a LABELLED control in the bar —
  // the one placement that survives. It must not go back onto the call card:
  // `collapsed` hides that card, and the tile is closed in exactly the state
  // this control exists for, so a card-mounted reopen is unreachable precisely
  // when it is needed.
  it("puts the reopen control in the control bar, not on the call card", () => {
    const { container } = render(<AudioCallOverlay {...baseProps} showReopenTile onReopenTile={vi.fn()} />);
    const reopen = screen.getByRole("button", { name: /reopen tile/i });
    const card = container.querySelector('[data-testid="audio-call-card"]') as HTMLElement;

    expect(card.contains(reopen)).toBe(false);
    // Same container as End call — i.e. the shell's control bar.
    const bar = screen.getByRole("button", { name: /^end call$/i }).parentElement as HTMLElement;
    expect(bar.contains(reopen)).toBe(true);
    // ...but NOT in the toggle tray, which sits inside that same bar. `contains`
    // is recursive, so the assertion above is satisfied by tray membership too
    // (verified by mutation: moving the control into the tray left this file
    // green). The tray's entire vocabulary is `aria-pressed` call-adjusting
    // toggles; reopen carries no pressed state and, like Connect, hands the
    // agent to another window. Grouping it with Mute and Captions would say it
    // adjusts the call.
    expect(screen.getByTestId("call-control-tray").contains(reopen)).toBe(false);
    // Sized to its neighbours (spec §6): the shared `sm` control scale.
    expect(reopen.className).toContain("h-8");
  });

  it("renders no reopen control while the tile is up", () => {
    render(<AudioCallOverlay {...baseProps} />);
    expect(screen.queryByRole("button", { name: /reopen tile/i })).toBeNull();
  });

  it("collapses the call card (hidden) when the tile is up (collapsed)", () => {
    const { container } = render(<AudioCallOverlay {...baseProps} collapsed />);
    const card = container.querySelector('[data-testid="audio-call-card"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.className).toContain("hidden");
  });

  it("shows the call card when not collapsed (default)", () => {
    const { container } = render(<AudioCallOverlay {...baseProps} />);
    const card = container.querySelector('[data-testid="audio-call-card"]') as HTMLElement;
    expect(card.className).not.toContain("hidden");
  });

  it("hides the caption band while the tile is up (collapsed) so captions aren't doubled with the tile", () => {
    render(<AudioCallOverlay {...baseProps} captionFinals={["I need extra towels"]} collapsed />);
    const band = screen.getByText(/I need extra towels/i).closest("div") as HTMLElement;
    expect(band.className).toContain("hidden");
  });

  it("shows the caption band when not collapsed", () => {
    render(<AudioCallOverlay {...baseProps} captionFinals={["I need extra towels"]} />);
    const band = screen.getByText(/I need extra towels/i).closest("div") as HTMLElement;
    expect(band.className).not.toContain("hidden");
  });

  // The audio body is deliberately playbook-heavy: the call card needs less room
  // than the document the agent reads to handle the guest, and audio has no
  // video to show at all. Task 12 widened it from 63% to 70% (spec §4, D9) —
  // 63/37 was barely distinguishable from video's 60/40, which is the drift the
  // shared shell exists to stop. Nothing pinned this before Task 11: a reviewer
  // inverted the shell's SPLITS map and the whole suite stayed green.
  it("gives the playbook 70% of the body and the call card 30%", () => {
    const { container } = render(<AudioCallOverlay {...baseProps} />);
    const card = container.querySelector('[data-testid="audio-call-card"]') as HTMLElement;
    expect(card.className).toContain("basis-[30%]");
    expect(screen.getByTestId("playbook").getAttribute("data-basis")).toBe("basis-[70%]");
  });

  it("gives the playbook the full width when collapsed (the tile owns the call)", () => {
    render(<AudioCallOverlay {...baseProps} collapsed />);
    expect(screen.getByTestId("playbook").getAttribute("data-basis")).toBe("basis-full");
  });

  // The two banner positions are structurally distinct. The emergency strips
  // carry the instruction to relay the property address during a live 911
  // conference; pushed below the body they would sit under the playbook,
  // potentially off-screen. Swapping the shell's two slots is invisible without
  // these two assertions.
  it("renders the emergency banner ABOVE the call card", () => {
    const { container } = render(<AudioCallOverlay {...baseProps} emergencyActive />);
    const banner = screen.getByText(/Emergency active/i);
    const card = container.querySelector('[data-testid="audio-call-card"]') as HTMLElement;
    expect(banner.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the caption band BELOW the call card", () => {
    const { container } = render(
      <AudioCallOverlay {...baseProps} captionFinals={["I need extra towels"]} />,
    );
    const band = screen.getByText(/I need extra towels/i).closest("div") as HTMLElement;
    const card = container.querySelector('[data-testid="audio-call-card"]') as HTMLElement;
    expect(card.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // LIFE SAFETY. `collapsed` hides the call card and the caption band — never
  // the header. When DocPiP is unsupported or the agent closed the call tile,
  // this dialog is the ONLY 911. The header renders unconditionally inside the
  // shared CallShell, a file Tasks 12 and 13 edit for VIDEO reasons; without
  // this test, gating the header would silently remove audio's last-resort 911
  // and every other test would still pass.
  it("keeps 911 reachable while the call tile is up (collapsed)", async () => {
    const user = userEvent.setup();
    const onTriggerEmergency = vi.fn();
    render(
      <AudioCallOverlay {...baseProps} collapsed onTriggerEmergency={onTriggerEmergency} />,
    );

    await user.click(screen.getByRole("button", { name: /call 911/i }));
    await user.click(screen.getByRole("button", { name: /yes — call 911/i }));

    expect(onTriggerEmergency).toHaveBeenCalledOnce();
  });

  // LIFE SAFETY, the colour half. This is the ONE surface where a red 911 button
  // and the end-call button are on screen together. `End call` is blaze rather
  // than navy precisely because red was reading as the "end call" cue
  // (punch-list B1, Kumar 2026-06-18), and 911 stays red and alone in the
  // header. Both facts have to hold, or a mistap reaches 911 mid-shift.
  it("keeps 911 red in the header and End call blaze, never the same colour", () => {
    render(<AudioCallOverlay {...baseProps} />);

    const emergency = screen.getByRole("button", { name: /call 911/i });
    const end = screen.getByRole("button", { name: /^end call$/i });

    expect(emergency.className).toContain("bg-destructive");
    expect(end.className).toContain("bg-attention");
    expect(end.className).not.toContain("bg-destructive");
    // 911 is not a sibling of End call — it lives alone in the header strip.
    expect(emergency.parentElement === end.parentElement).toBe(false);
  });

  // §5.3: the bar must not move under the agent's cursor mid-call. Audio has no
  // camera control, so Mute is the only toggle that could reflow it.
  it("keeps Mute labelled the same once toggled, carrying state in aria-pressed", () => {
    const { rerender } = render(<AudioCallOverlay {...baseProps} muted={false} />);
    const mute = screen.getByRole("button", { name: /^mute$/i });
    expect(mute.getAttribute("aria-pressed")).toBe("false");

    rerender(<AudioCallOverlay {...baseProps} muted />);
    expect(screen.getByRole("button", { name: /^mute$/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: /unmute/i })).toBeNull();
  });

  // Neither ever existed on this surface — pinned so a later "make the two bars
  // the same" pass cannot import video's dead controls instead of deleting them.
  it("has no Hold or Swap controls", () => {
    render(<AudioCallOverlay {...baseProps} />);
    expect(screen.queryByRole("button", { name: /^hold$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^swap$/i })).toBeNull();
  });
});
