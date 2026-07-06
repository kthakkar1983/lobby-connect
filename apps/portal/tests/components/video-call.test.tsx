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
      <VideoCall callId="call-99" onClose={onClose} propertyName="The Sample Hotel" />,
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
      <VideoCall callId="call-busycam" onClose={onClose} propertyName="The Sample Hotel" />,
    );

    // Joined despite the camera being unavailable.
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());

    // The call was NOT abandoned.
    expect(onClose).not.toHaveBeenCalled();
    // The agent is told they're audio-only.
    await waitFor(() => expect(screen.getByText(/camera is unavailable/i)).toBeTruthy());
  });

  it("captions the guest audio: captures the remote track and renders the band", async () => {
    render(<VideoCall callId="call-cap" onClose={vi.fn()} propertyName="The Sample Hotel" />);
    await waitFor(() => expect(lk.joined.opts).not.toBeNull());

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
    render(<VideoCall callId="call-autoplay" onClose={vi.fn()} propertyName="The Sample Hotel" />);
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
    render(<VideoCall callId="call-cap" onClose={onClose} propertyName="The Sample Hotel" />);
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
});
