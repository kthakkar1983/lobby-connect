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
import type * as RemoteAccessConnect from "@/lib/remote-access/connect";

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

// Document-PiP harness (Task 13). jsdom has no documentPictureInPicture, so the
// real docPipSupported() is false and the reopen control could never render.
// `openCallTile` deliberately NEVER invokes onReady: leaving the provider's tile
// handle unset keeps `tileMount` null (so no real CallTile is portaled into the
// test DOM) while still letting a later openTileForCall() through — the provider
// short-circuits only when a handle exists.
const tile = vi.hoisted(() => {
  const cbs: { onClosed: (() => void) | null } = { onClosed: null };
  return {
    cbs,
    docPipSupported: vi.fn(() => true),
    openCallTile: vi.fn((_onReady: unknown, onClosed: () => void) => {
      cbs.onClosed = onClosed;
    }),
  };
});
vi.mock("@/lib/duty-tile/call-tile-manager", () => ({
  docPipSupported: tile.docPipSupported,
  openCallTile: tile.openCallTile,
}));

// Task 14: the Connect control drives the REAL connectToProperty through a real
// CallSurfaceProvider — only its leaf dependencies are mocked (network fetch +
// the OS handoff), the same split call-tile.test.tsx uses. `launchRustdesk` in
// particular must never be replaced by anything that navigates: it launches
// rustdesk:// through a hidden iframe precisely because a top-window navigation
// fires pagehide and livekit-client tears the live room down on pagehide.
const remoteAccess = vi.hoisted(() => ({
  fetchRemoteCredentials: vi.fn(),
  launchRustdesk: vi.fn(),
}));
vi.mock("@/lib/remote-access/connect", async (importOriginal) => {
  const actual = await importOriginal<typeof RemoteAccessConnect>();
  return {
    ...actual,
    fetchRemoteCredentials: remoteAccess.fetchRemoteCredentials,
    launchRustdesk: remoteAccess.launchRustdesk,
  };
});

import { VideoCall } from "@/components/video-call/video-call";
import { CallSurfaceProvider, useCallSurface } from "@/components/dashboard/call-surface-provider";

// Captions default OFF (spec D7) — this harness turns them on via the surface.
function EnableCaptions() {
  const { toggleCaptions } = useCallSurface();
  return <button onClick={toggleCaptions}>enable captions</button>;
}

// `tileClosedByUser` and `openTileForCall` are CONTEXT, not props (the plan said
// otherwise). The only way into the closed-tile state is the provider's own
// path: a live call, an opened tile, then the PiP window's pagehide. This probe
// drives exactly that. propertyId is null on purpose — a non-null one would
// trip the provider's credential pre-warm and put an unrelated fetch in flight.
function TileProbe() {
  const { publishActive, openTileForCall } = useCallSurface();
  return (
    <>
      <button
        onClick={() =>
          publishActive("VIDEO", {
            callId: "call-active",
            channel: "VIDEO",
            propertyId: null,
            propertyName: "The Sample Hotel",
            onHold: false,
            answeredAt: Date.now(),
            timeZone: null,
          })
        }
      >
        go active
      </button>
      <button onClick={openTileForCall}>open tile</button>
    </>
  );
}

describe("VideoCall — provider-neutral behavior (livekit harness)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    lk.joined.opts = null;
    lk.resetSession();
    tile.cbs.onClosed = null;
    // Re-arm explicitly: clearAllMocks() clears calls but NOT a mockReturnValue,
    // so the unsupported-DocPiP test's `false` would otherwise leak forward and
    // silently blank the reopen control for every test declared after it.
    tile.docPipSupported.mockReturnValue(true);
    // Same reason as docPipSupported above: clearAllMocks() clears CALLS but not
    // a mockResolvedValue, so one test's Connect outcome would leak into every
    // test declared after it.
    remoteAccess.fetchRemoteCredentials.mockReset();
    remoteAccess.launchRustdesk.mockReset();
    remoteAccess.fetchRemoteCredentials.mockResolvedValue({ ok: false, notConfigured: false });
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

  // Task 14: Connect moved onto <PropertyActionButton>. The three checks below
  // pin what that move must NOT change and the one thing it exists to add.
  //
  // The tone is a DELIBERATE split (2026-07-10 batch-1 polish): navy on the
  // property cards, teal on all three in-call Connects. PropertyActionButton
  // defaults to navy, so an omitted `tone="teal"` reverts that polish silently —
  // the same reversal call-tile.test.tsx:440-449 already guards on the tile.
  it("keeps the in-call Connect teal after the move onto PropertyActionButton", async () => {
    render(
      <CallSurfaceProvider>
        <VideoCall callId="call-teal" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />
      </CallSurfaceProvider>,
    );
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());
    const connect = screen.getByRole("button", { name: /connect/i });
    expect(connect.className).toContain("bg-accent");
    // Enabled once there is both a property and a provider — the disabled state
    // above must stay tied to those two reasons and nothing else.
    expect(connect).toHaveProperty("disabled", false);
  });

  // Spec §7's behavioural gap. Every in-call Connect called connectToProperty as
  // a bare `void` with no catch, so a failed launch was SILENT: the agent
  // pressed Connect mid guest-call, RustDesk never opened, and nothing on screen
  // said whether it was still coming.
  it("surfaces a failed remote-access launch instead of failing silently", async () => {
    const user = userEvent.setup();
    remoteAccess.fetchRemoteCredentials.mockResolvedValue({ ok: false, notConfigured: true });
    render(
      <CallSurfaceProvider>
        <VideoCall callId="call-connect-fail" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />
      </CallSurfaceProvider>,
    );
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /connect/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("No remote access configured — ask an admin.");
    expect(remoteAccess.launchRustdesk).not.toHaveBeenCalled();
  });

  it("clears a previous Connect failure once a later attempt launches", async () => {
    const user = userEvent.setup();
    remoteAccess.fetchRemoteCredentials.mockResolvedValueOnce({ ok: false, notConfigured: false });
    render(
      <CallSurfaceProvider>
        <VideoCall callId="call-connect-retry" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />
      </CallSurfaceProvider>,
    );
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    const connect = screen.getByRole("button", { name: /connect/i });
    await user.click(connect);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not fetch credentials — try again.",
    );

    // A stale failure left on screen after a working retry would read as "still
    // broken" for the rest of the call.
    remoteAccess.fetchRemoteCredentials.mockResolvedValue({
      ok: true,
      creds: { peerId: "peer-1", password: "pw" },
    });
    await user.click(connect);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(remoteAccess.launchRustdesk).toHaveBeenCalledWith({ peerId: "peer-1", password: "pw" });
  });

  // A THROW is the third failure mode, and the one that would restore the
  // silence completely: connectToProperty runs openTileForCall() and
  // launchRustdesk() synchronously and fetchRemoteCredentials behind an await,
  // and an unguarded rejection skips the error state entirely and surfaces as an
  // unhandled rejection instead. It maps to the TRANSIENT wording — an exception
  // is not evidence that the property has no credentials configured.
  it("surfaces a thrown Connect as a retryable failure, not silence", async () => {
    const user = userEvent.setup();
    remoteAccess.fetchRemoteCredentials.mockRejectedValue(new Error("boom"));
    render(
      <CallSurfaceProvider>
        <VideoCall callId="call-connect-throw" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />
      </CallSurfaceProvider>,
    );
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /connect/i }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not fetch credentials — try again.",
    );
  });

  // The SECOND unavailable reason, isolated. The disabled test above renders
  // with propertyId={null} AND without a CallSurfaceProvider, so its first
  // branch always wins — deleting the `!connectToProperty` branch would leave
  // that test green. This pins the branch on its own: a property, but nothing
  // to connect WITH.
  it("disables Connect outside a CallSurfaceProvider even with a property", async () => {
    render(
      <VideoCall callId="call-noprovider" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />,
    );
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());
    const connect = screen.getByRole("button", { name: /connect/i });
    expect(connect).toHaveProperty("disabled", true);
    // And it must read as REAL unavailability, never as duty: starting a shift
    // would give this call neither a property nor a provider, so offering to is
    // a lie.
    expect(connect.getAttribute("title")).toBe("Remote access is unavailable here");
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

  // Task 4 (spec §3.1): mirrors audio's Task-3 reorder — Connect now LEADS the
  // cluster (immediately after the input group), the <CallControlTray> wrapper
  // is gone (Mute/Camera/Captions sit as flat siblings), and End call stays the
  // far-right bookend after the divider.
  it("orders the control bar Connect, Mute, Camera, Captions, End call (spec §3.1)", async () => {
    render(
      <VideoCall callId="call-order" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />,
    );
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    const names = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    const connect = names.findIndex((n) => /connect/i.test(n));
    const mute = names.findIndex((n) => /^mute$/i.test(n));
    const camera = names.findIndex((n) => /camera/i.test(n));
    const captions = names.findIndex((n) => /captions/i.test(n));
    const end = names.findIndex((n) => /end call/i.test(n));
    expect(connect).toBeGreaterThanOrEqual(0);
    expect(connect).toBeLessThan(mute);
    expect(mute).toBeLessThan(camera);
    expect(camera).toBeLessThan(captions);
    expect(captions).toBeLessThan(end);
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

  // Item 4 (2026-07-21): the tile drives the agent's camera through the surface's
  // registered controls. VideoCall must REGISTER toggleCamera + the live cameraOff
  // state (audio omits them — no camera), and re-register when cameraOff changes
  // so the tile mirror stays truthful. This pins the video-call side of the wiring;
  // the tile side is pinned in call-tile.test.tsx.
  it("registers a working camera toggle with the surface so the tile can drive it", async () => {
    const user = userEvent.setup();
    function CamProbe() {
      const { callControls } = useCallSurface();
      return (
        <div
          data-testid="cam-probe"
          data-has-toggle={String(typeof callControls?.toggleCamera === "function")}
          data-camera-off={String(callControls?.cameraOff ?? "none")}
        />
      );
    }
    render(
      <CallSurfaceProvider>
        <VideoCall callId="call-camreg" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />
        <CamProbe />
      </CallSurfaceProvider>,
    );
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    const probe = () => screen.getByTestId("cam-probe");
    // Registered on mount: the surface exposes the toggle + the initial state.
    await waitFor(() => expect(probe().getAttribute("data-has-toggle")).toBe("true"));
    expect(probe().getAttribute("data-camera-off")).toBe("false");

    // Toggling the overlay Camera flips the REGISTERED state (re-registration on
    // the cameraOff dependency), so the tile mirror is never stale.
    await user.click(screen.getByRole("button", { name: /^camera\b/i }));
    await waitFor(() => expect(probe().getAttribute("data-camera-off")).toBe("true"));
  });

  // D2 (2026-07-20): `End call` is blaze on BOTH surfaces now. This test used
  // to pin D11 (navy on video; audio's blaze kept separate as a deliberate
  // punch-list-B1 override) — that per-surface split existed only because
  // audio's surface also carries a red 911 button, and blaze separated `End
  // call` from it. Video has no 911 machinery anywhere, so the split bought
  // nothing there; D2 supersedes D11 and unifies the fill. See the
  // EndCallButton docblock in call-controls.tsx.
  it("End call is blaze on video (unified with audio, spec D2)", async () => {
    render(<VideoCall callId="call-endtone" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />);
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    const end = screen.getByRole("button", { name: /^end call$/i });
    expect(end.className).toContain("bg-attention");
    expect(end.className).not.toContain("bg-primary");
  });

  // ---- Task 13: the reopen-tile control (spec §6) ----------------------------

  /** Mount inside a real surface, take a call live, open the tile, then close it
   *  the way the agent does — the PiP window's pagehide. Returns the user so the
   *  caller can keep interacting. */
  async function renderWithClosedTile(callId = "call-reopen") {
    const user = userEvent.setup();
    const view = render(
      <CallSurfaceProvider>
        <TileProbe />
        <VideoCall callId={callId} onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />
      </CallSurfaceProvider>,
    );
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());
    await user.click(screen.getByText("go active"));
    await user.click(screen.getByText("open tile"));
    // The provider only flips tileClosedByUser when the close was NOT its own.
    await act(async () => {
      tile.cbs.onClosed!();
    });
    return { user, view };
  }

  // Removing the visible label must not remove the NAME. An icon-only control
  // with no aria-label is announced as "button" and is unusable by voice
  // control; the title is additionally how a new agent learns the glyph.
  it("keeps an accessible name and a tooltip on the icon-only reopen control", async () => {
    await renderWithClosedTile("call-reopen-name");
    const btn = screen.getByRole("button", { name: "Reopen tile" });
    // Icon-only: the name comes from aria-label, not from rendered text.
    expect(btn.textContent).toBe("");
    // BOTH attributes, asserted directly. Resolving the control by its
    // accessible name does NOT prove aria-label is present: per the
    // accessible-name computation `title` is a valid last-resort name source,
    // so getByRole({name}) alone stays green if aria-label is deleted (verified
    // by mutation). The two are not interchangeable — components/call/
    // call-controls.tsx documents that assistive tech exposes title-derived
    // names inconsistently (VoiceOver commonly drops it), which is exactly why
    // spec §6 requires the explicit label as well as the tooltip.
    expect(btn.getAttribute("aria-label")).toBe("Reopen tile");
    expect(btn.getAttribute("title")).toBe("Reopen tile");
  });

  // The two things this task exists to change about the control's appearance —
  // where it sits and how legible its boundary is — were otherwise pinned by
  // nothing. Reverting either (bottom-3 -> bottom-16, /90 -> /60) left the whole
  // suite green, so a later tidy-up could silently undo both: the mid-frame
  // placement over the guest's face, and a scrim alpha whose contrast figure is
  // load-bearing (see the source comment — /60 puts the worst case at 2.33:1,
  // an outright 1.4.11 failure).
  it("keeps the reopen control in the corner, on a scrim heavy enough to read", async () => {
    await renderWithClosedTile("call-reopen-corner");
    const btn = screen.getByRole("button", { name: "Reopen tile" });
    expect(btn.className).toContain("bottom-3");
    expect(btn.className).toContain("right-3");
    expect(btn.className).toContain("bg-call/90");
  });

  // DocPiP unsupported => there is no window to reopen INTO, so the affordance
  // must not be offered. Every other test in this file runs with the support
  // probe forced true (jsdom has no documentPictureInPicture, so the control
  // could otherwise never render at all), which left this branch — the one that
  // decides whether a whole class of browser sees a dead button — uncovered.
  it("offers no reopen control when Document PiP is unsupported", async () => {
    tile.docPipSupported.mockReturnValue(false);
    await renderWithClosedTile("call-reopen-nopip");
    expect(screen.queryByRole("button", { name: "Reopen tile" })).toBeNull();
  });

  it("reopens the tile when the corner control is pressed", async () => {
    const { user } = await renderWithClosedTile("call-reopen-click");
    const before = tile.openCallTile.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Reopen tile" }));
    expect(tile.openCallTile.mock.calls.length).toBe(before + 1);
  });

  it("renders no reopen control while the tile is still open", async () => {
    const user = userEvent.setup();
    render(
      <CallSurfaceProvider>
        <TileProbe />
        <VideoCall callId="call-tile-open" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />
      </CallSurfaceProvider>,
    );
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());
    await user.click(screen.getByText("go active"));
    await user.click(screen.getByText("open tile"));

    expect(screen.queryByRole("button", { name: "Reopen tile" })).toBeNull();
  });

  // Spec §6: the control sits in the TRUE bottom-right corner, so the caption
  // band has to give the corner up rather than the button floating on top of
  // the band. Without this the band's own backdrop sits under a 40px circle and
  // the last words of the guest's sentence are the ones covered.
  it("insets the caption band's right edge while the corner control is present", async () => {
    const user = userEvent.setup();
    render(
      <CallSurfaceProvider>
        <TileProbe />
        <EnableCaptions />
        <VideoCall callId="call-band-inset" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />
      </CallSurfaceProvider>,
    );
    await waitFor(() => expect(lk.joined.opts).not.toBeNull());

    // Go active BEFORE enabling captions: the provider resets captionsEnabled to
    // false on every callId transition (spec D7), so the other order silently
    // switches them back off and the band never renders.
    await user.click(screen.getByText("go active"));
    await act(async () => screen.getByText("enable captions").click());
    await act(async () => {
      (lk.joined.opts!.onRemoteAudioTrack as (t: MediaStreamTrack) => void)({
        kind: "audio",
      } as unknown as MediaStreamTrack);
    });

    const band = () => screen.getByText(/could I get a late checkout/i).closest("div") as HTMLElement;
    // Tile still open — no corner control, so the band spans the full stage.
    expect(band().className).toContain("right-3");
    expect(band().className).not.toContain("right-16");

    await user.click(screen.getByText("open tile"));
    await act(async () => {
      tile.cbs.onClosed!();
    });

    expect(band().className).toContain("right-16");
  });
});
