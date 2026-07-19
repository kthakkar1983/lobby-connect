/**
 * Provider-neutral behavioral coverage for VideoCall, exercised through the
 * LiveKit harness (the only remaining video provider). Complements
 * video-call-livekit.test.tsx (join / guest-left→end-video / mute / captions
 * track) with the behaviors that used to live under the legacy provider harness:
 *
 *  - Regression (H1): VideoCall must NOT lose typed roomNumber/notes when the
 *    guest hangs up. handleEnd() closes over roomNumber/notes state, and
 *    onGuestLeft = () => void handleEnd() captures the *initial* handleEnd
 *    (empty strings). The fix ref-mirrors roomNumber/notes so the stale closure
 *    reads the current values.
 *  - A busy webcam must not abandon the call (connect audio-only + warn).
 *  - Blocked remote-audio autoplay surfaces a deterministic "Tap to hear guest"
 *    control that recovers on click.
 *  - An abandoned connected call auto-ends at the max-duration cap.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MAX_CALL_DURATION_MS } from "@lc/shared";

// vi.hoisted: variables created here are available inside vi.mock() factories,
// which are hoisted before top-level module code.
const lk = vi.hoisted(() => {
  const session = {
    localVideo: { attach: vi.fn(), detach: vi.fn(), mediaStreamTrack: vi.fn(() => ({ enabled: true })) } as {
      attach: ReturnType<typeof vi.fn>;
      detach: ReturnType<typeof vi.fn>;
      mediaStreamTrack: ReturnType<typeof vi.fn>;
    } | null,
    localAudioMediaTrack: { enabled: true } as unknown as MediaStreamTrack,
    mediaWarning: null as "camera" | "mic" | "both" | null,
    setMicMuted: vi.fn(async () => {}),
    leave: vi.fn(async () => {}),
  };
  const joined: { opts: Record<string, unknown> | null } = { opts: null };
  const joinLiveKitCall = vi.fn(async (opts: Record<string, unknown>) => {
    joined.opts = opts;
    return session;
  });
  // Reset the session's mutable fields between tests (the object identity is
  // reused across the hoisted closure).
  const resetSession = () => {
    session.localVideo = { attach: vi.fn(), detach: vi.fn(), mediaStreamTrack: vi.fn(() => ({ enabled: true })) };
    session.mediaWarning = null;
  };
  return { session, joined, joinLiveKitCall, resetSession };
});

vi.mock("@/lib/video/livekit-session", () => ({ joinLiveKitCall: lk.joinLiveKitCall }));

// Stub PlaybookPanel to prevent its own fetch calls from polluting assertions.
vi.mock("@/components/call/playbook-panel", () => ({
  PlaybookPanel: () => null,
}));

const captionsSpy = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/captions/use-captions", () => ({
  useCaptions: (track: MediaStreamTrack | null) => {
    captionsSpy.fn(track);
    return { finals: track ? ["could I get a late checkout"] : [], partial: "", status: track ? "live" : "idle" };
  },
}));

import { VideoCall } from "@/components/video-call/video-call";
import { CallSurfaceProvider, useCallSurface } from "@/components/dashboard/call-surface-provider";

// Captions default OFF (spec D7) — this harness turns them on via the surface.
function EnableCaptions() {
  const { toggleCaptions } = useCallSurface();
  return <button onClick={toggleCaptions}>enable captions</button>;
}

describe("VideoCall — provider-neutral behavior (livekit harness)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    lk.joined.opts = null;
    lk.resetSession();
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/answer-video")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ channelName: "ch-test" }),
        });
      }
      if (typeof url === "string" && url.includes("/api/video/token")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              provider: "livekit",
              url: "wss://lk",
              token: "jwt",
              channelName: "ch-test",
            }),
        });
      }
      // notes, end-video, etc.
      return Promise.resolve({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("saves typed roomNumber+notes when guest hangs up (guest-left), not stale empty strings", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <VideoCall callId="call-99" onClose={onClose} propertyName="The Sample Hotel" propertyId="prop-1" />,
    );

    // Wait until the LiveKit session has joined — all async setup precedes join.
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    // Type room number and notes AFTER setup; this is where the stale-closure
    // bug bit (state updates after the guest-left callback was registered).
    const roomInput = screen.getByPlaceholderText("Room #");
    const notesInput = screen.getByPlaceholderText("Notes…");
    await user.type(roomInput, "204");
    await user.type(notesInput, "extra pillows requested");

    // Simulate guest hanging up (LiveKit participant disconnect → onGuestLeft).
    await act(async () => {
      (lk.joined.opts!.onGuestLeft as () => void)();
    });

    // Notes API must have been called with the TYPED values, not empty strings.
    const notesCalls = fetchMock.mock.calls.filter(
      (args) => (args[0] as string) === "/api/calls/notes",
    );
    expect(notesCalls).toHaveLength(1);

    const firstCall = notesCalls[0];
    expect(firstCall).toBeDefined();
    const body = JSON.parse((firstCall?.[1] as { body: string }).body) as {
      callId: string;
      roomNumber: string;
      notes: string;
    };
    expect(body.roomNumber).toBe("204");
    expect(body.notes).toBe("extra pillows requested");
  });

  // Regression: a busy webcam (held by another app) must NOT abandon the call.
  // The session connects audio-only and reports mediaWarning:"camera"; the
  // component surfaces the audio-only warning and stays on the call.
  it("stays connected audio-only when the camera is busy, instead of abandoning the call", async () => {
    const onClose = vi.fn();
    lk.session.localVideo = null;
    lk.session.mediaWarning = "camera";

    render(
      <VideoCall callId="call-busycam" onClose={onClose} propertyName="The Sample Hotel" propertyId="prop-1" />,
    );

    // Joined despite the camera being unavailable.
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    // The call was NOT abandoned.
    expect(onClose).not.toHaveBeenCalled();
    // The agent is told they're audio-only.
    await waitFor(() => expect(screen.getByText(/camera is unavailable/i)).toBeTruthy());
  });

  it("captions the guest audio when captions are ON: captures the remote track and renders the band", async () => {
    render(
      <CallSurfaceProvider>
        <EnableCaptions />
        <VideoCall callId="call-cap" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />
      </CallSurfaceProvider>,
    );
    await waitFor(() => expect(lk.joined.opts).not.toBeNull());
    // Captions default OFF — turn them on, then the guest track flows to useCaptions.
    await act(async () => screen.getByText("enable captions").click());

    const guestTrack = { kind: "audio" } as unknown as MediaStreamTrack;
    await act(async () => {
      (lk.joined.opts!.onRemoteAudioTrack as (t: MediaStreamTrack) => void)(guestTrack);
    });

    await waitFor(() => expect(captionsSpy.fn).toHaveBeenCalledWith(guestTrack));
    expect(screen.getByText(/could I get a late checkout/i)).toBeTruthy();
  });

  // Hardening: when the browser blocks the cold first-call autoplay of the guest
  // audio, the recovery must NOT depend on a stray pointer/keydown the agent may
  // never make. Surface a deterministic "Tap to hear guest" control that recovers
  // on click. (The first-call no-audio symptom.)
  it("surfaces a 'Tap to hear guest' control on blocked autoplay and recovers on click", async () => {
    const user = userEvent.setup();
    render(<VideoCall callId="call-autoplay" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />);
    await waitFor(() => expect(lk.joined.opts).not.toBeNull());

    // No control while audio is presumed playing.
    expect(screen.queryByRole("button", { name: /tap to hear guest/i })).toBeNull();

    // The SDK reports the cold autoplay as blocked, handing back a recover fn.
    const recover = vi.fn();
    await act(async () => {
      (lk.joined.opts!.onAudioBlocked as (recover: () => void) => void)(recover);
    });

    const btn = screen.getByRole("button", { name: /tap to hear guest/i });
    await user.click(btn);

    // recover() ran (>=1: the click handler; the gesture backstop may also fire)
    // and the control cleared once recovered.
    expect(recover.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: /tap to hear guest/i })).toBeNull();
  });

  // Cost backstop: an abandoned connected call (agent leaves the tab open) must
  // auto-end at the max-duration cap so the video room + its billing stop —
  // rather than lingering to the 1h token expiry / daily reaper.
  it("auto-ends the call at the max-duration cap (finalizes + leaves the room)", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const onClose = vi.fn();
    render(<VideoCall callId="call-cap" onClose={onClose} propertyName="The Sample Hotel" propertyId="prop-1" />);
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    // The cap timer is armed with MAX_CALL_DURATION_MS once the call is joined.
    await waitFor(() =>
      expect(setTimeoutSpy.mock.calls.some((c) => c[1] === MAX_CALL_DURATION_MS)).toBe(true),
    );
    const capCall = setTimeoutSpy.mock.calls.find((c) => c[1] === MAX_CALL_DURATION_MS);
    const fireCap = capCall![0] as () => void;

    // Fire the cap: the call finalizes (end-video) and the session leaves.
    await act(async () => {
      fireCap();
      await Promise.resolve();
    });

    const endVideoCalls = fetchMock.mock.calls.filter((a) =>
      (a[0] as string).includes("/end-video"),
    );
    expect(endVideoCalls.length).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(lk.session.leave).toHaveBeenCalled());

    setTimeoutSpy.mockRestore();
  });

  // Phase E (Task 19b): the Connect control (remote access to the hotel PC)
  // is disabled when the call carries no propertyId to resolve credentials
  // for — mirrors the nullable-propertyId rule used on the audio overlay.
  it("disables the Connect control when propertyId is null", async () => {
    render(
      <VideoCall callId="call-noprop" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId={null} />,
    );
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /connect/i })).toHaveProperty("disabled", true);
  });

  // Parity with the audio overlay: an explicit in-call notes save on Enter (and
  // Tab) with in-field feedback — not just the teardown-time save.
  it("saves notes on Enter mid-call and shows a saved indicator", async () => {
    const user = userEvent.setup();
    render(<VideoCall callId="call-notes" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />);
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    await user.type(screen.getByPlaceholderText("Notes…"), "extra towels{Enter}");

    const notesCalls = fetchMock.mock.calls.filter((a) => (a[0] as string) === "/api/calls/notes");
    expect(notesCalls).toHaveLength(1);
    await waitFor(() => expect(screen.getByText(/notes saved/i)).toBeTruthy());
  });

  it("saves notes on Tab mid-call", async () => {
    const user = userEvent.setup();
    render(<VideoCall callId="call-notes2" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />);
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    await user.type(screen.getByPlaceholderText("Room #"), "204{Tab}");

    const notesCalls = fetchMock.mock.calls.filter((a) => (a[0] as string) === "/api/calls/notes");
    expect(notesCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("collapses the guest-video stage (hidden) when the tile is up (collapsed prop)", async () => {
    const { container } = render(
      <VideoCall callId="call-collapse" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" collapsed />,
    );
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());
    const stage = container.querySelector('[data-testid="guest-video-stage"]') as HTMLElement;
    expect(stage).toBeTruthy();
    expect(stage.className).toContain("hidden");
  });

  it("shows the guest-video stage when not collapsed (default)", async () => {
    const { container } = render(
      <VideoCall callId="call-expand" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />,
    );
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());
    const stage = container.querySelector('[data-testid="guest-video-stage"]') as HTMLElement;
    expect(stage.className).not.toContain("hidden");
  });

  // Task 10: the non-collapsed overlay gains a Playbook⇄Chat tab in the right
  // panel; clicking Chat swaps the (mocked-null) PlaybookPanel for the real
  // ChatDock, which renders its own message input.
  it("shows the ChatDock input when the Chat tab is clicked (non-collapsed overlay)", async () => {
    const user = userEvent.setup();
    render(
      <VideoCall callId="call-chat-tab" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />,
    );
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /^chat$/i }));
    expect(screen.getByPlaceholderText(/type/i)).toBeTruthy();
  });

  // Characterization (Task 11 → 12). Video's body is 40/60 — the guest stage is
  // the SMALLER half, the playbook/chat panel the larger. Nothing pinned this
  // before: a reviewer inverted the shell's SPLITS map, swapping both surfaces'
  // stage and panel classes, and the whole jsdom suite stayed green. Video's
  // ratio is unchanged by Task 12; audio's is not, and this is the guard that
  // the audio edit does not drag video along with it.
  it("gives the playbook panel 3/5 of the body and the guest stage 2/5", async () => {
    const { container } = render(
      <VideoCall callId="call-split" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />,
    );
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    const stage = container.querySelector('[data-testid="guest-video-stage"]') as HTMLElement;
    const panel = container.querySelector('[data-testid="video-right-panel"]') as HTMLElement;
    expect(stage.className).toContain("basis-2/5");
    expect(panel.className).toContain("basis-3/5");
  });

  // The two banner positions are structurally distinct slots on the shared
  // shell, and swapping them is invisible without an ordering assertion. The
  // media warning tells the agent she is connected audio-only; the notes
  // retry/discard affordance belongs beside the control bar, not above the call.
  it("renders the media warning ABOVE the guest stage", async () => {
    lk.session.localVideo = null;
    lk.session.mediaWarning = "camera";
    const { container } = render(
      <VideoCall callId="call-warnpos" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />,
    );
    await waitFor(() => expect(screen.getByText(/camera is unavailable/i)).toBeTruthy());

    const warning = screen.getByText(/camera is unavailable/i);
    const stage = container.querySelector('[data-testid="guest-video-stage"]') as HTMLElement;
    expect(warning.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the notes retry/discard affordance BELOW the guest stage", async () => {
    const user = userEvent.setup();
    // A 4xx is not retried by reliableFetch, so the save fails immediately and
    // handleEnd keeps the overlay mounted with the retry affordance up.
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url === "/api/calls/notes") {
        return Promise.resolve({ ok: false, status: 400 });
      }
      if (typeof url === "string" && url.includes("/answer-video")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ channelName: "ch-test" }) });
      }
      if (typeof url === "string" && url.includes("/api/video/token")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ provider: "livekit", url: "wss://lk", token: "jwt", channelName: "ch-test" }),
        });
      }
      return Promise.resolve({ ok: true });
    });

    const { container } = render(
      <VideoCall callId="call-savepos" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />,
    );
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    // Notes must be non-empty or saveNotes short-circuits as "nothing to save".
    await user.type(screen.getByPlaceholderText("Notes…"), "extra towels");
    await user.click(screen.getByRole("button", { name: /^end call$/i }));

    const affordance = await screen.findByText(/couldn't save notes/i);
    const stage = container.querySelector('[data-testid="guest-video-stage"]') as HTMLElement;
    expect(stage.compareDocumentPosition(affordance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Spec §4.3: when the tile is up, the overlay is collapsed to playbook-only —
  // the tile owns chat, so the collapsed overlay must render no tab strip at all.
  it("renders no Playbook/Chat tab when collapsed (tile owns chat)", async () => {
    render(
      <VideoCall
        callId="call-chat-collapsed"
        onClose={vi.fn()}
        propertyName="The Sample Hotel"
        propertyId="prop-1"
        collapsed
      />,
    );
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: /^chat$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^playbook$/i })).toBeNull();
  });

  // Spec §5.1 / D10. Both were hardcoded `disabled` with title="Coming soon",
  // and Hold was deferred entirely to multi-property when the Phase-3 plan was
  // gated. Removing them is what pays for `End call`'s longer label — so if
  // either comes back, the bar no longer fits what replaced it.
  it("no longer renders the dead Hold and Swap controls", async () => {
    render(<VideoCall callId="call-nodead" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />);
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: /^hold$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^swap$/i })).toBeNull();
  });

  // §5.3: the bar must not move under the agent's cursor mid-call. Both toggles
  // keep a fixed label and carry their state in the fill plus aria-pressed.
  it("keeps Mute and Camera labelled the same once toggled", async () => {
    const user = userEvent.setup();
    render(<VideoCall callId="call-noreflow" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />);
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    const mute = screen.getByRole("button", { name: /^mute$/i });
    // Anchored on the VISIBLE label, which is what can reflow. Camera's
    // accessible name additionally carries an sr-only state (below) — that is
    // deliberate and adds no layout, so the visible-label anchor still holds.
    const camera = screen.getByRole("button", { name: /^camera\b/i });
    expect(mute.getAttribute("aria-pressed")).toBe("false");
    expect(camera.getAttribute("aria-pressed")).toBe("false");

    await user.click(mute);
    await user.click(camera);

    // Same elements, same VISIBLE labels — only the pressed state changed.
    expect(screen.getByRole("button", { name: /^mute$/i })).toBe(mute);
    expect(screen.getByRole("button", { name: /^camera\b/i })).toBe(camera);
    expect(mute.getAttribute("aria-pressed")).toBe("true");
    expect(camera.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: /unmute|cam on|cam off/i })).toBeNull();
    // Mute stays bare: "Mute, pressed" is already unambiguous, so it carries no
    // composed state and its accessible name is exactly its visible label.
    expect(mute.textContent).toBe("Mute");
    // Camera's state lives in the NAME, never in the rendered text.
    expect(camera.textContent).toBe("Camera");
  });

  // A screen reader announces the accessible name plus the pressed state. On a
  // control named "Camera", `pressed` is TRUE when the camera is OFF, so the
  // bare name announces the exact inverse of the truth. `title` does not rescue
  // it — name-from-content beats the title attribute, so `title` never enters
  // the name. Failure this pins: an agent using a screen reader toggles her
  // camera, hears "Camera, pressed", believes she is on air, and completes a
  // guest check-in with a dead camera — on the surface that exists for kiosk
  // eye contact.
  it("announces the camera's true state, not just 'pressed'", async () => {
    const user = userEvent.setup();
    render(<VideoCall callId="call-camname" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />);
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    const camera = screen.getByRole("button", { name: /^camera\b/i });
    expect(camera.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: /camera is on/i })).toBe(camera);

    await user.click(camera);

    expect(camera.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /camera is off/i })).toBe(camera);
    // The two states must not share an accessible name.
    expect(screen.queryByRole("button", { name: /camera is on/i })).toBeNull();
  });

  // D11: `End call` on both surfaces, but VIDEO's fill is navy. Audio's blaze is
  // a deliberate punch-list-B1 override and must not leak here — video has no
  // 911 control to be confused with, and blaze is the needs-attention colour.
  it("ends the call with a navy 'End call' (audio's blaze must not leak here)", async () => {
    render(<VideoCall callId="call-endtone" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />);
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    const end = screen.getByRole("button", { name: /^end call$/i });
    expect(end.className).toContain("bg-primary");
    expect(end.className).not.toContain("bg-attention");
  });
});
