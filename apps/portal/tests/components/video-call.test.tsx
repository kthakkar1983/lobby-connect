/**
 * Regression: VideoCall was losing typed roomNumber/notes when the guest
 * hung up via the Agora "user-left" event.
 *
 * Root cause: handleEnd() is a regular render-body function that closes over
 * roomNumber/notes state. c.on("user-left", () => void handleEnd()) captures
 * the *initial* handleEnd (empty strings). Even after the agent typed room
 * and notes, the stale closure ran with "" — notes were never saved.
 *
 * Fix: ref-mirror roomNumber/notes; handleEnd reads roomNumberRef.current /
 * notesRef.current so the stale closure always reaches the current values.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// vi.hoisted: variables created here are available inside vi.mock() factories,
// which are hoisted before top-level module code.
const agora = vi.hoisted(() => {
  const userLeftListeners: Array<() => void> = [];
  const userPublishedListeners: Array<(user: unknown, mediaType: string) => void> = [];
  const client = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === "user-left") userLeftListeners.push(cb as () => void);
      if (event === "user-published") userPublishedListeners.push(cb as (u: unknown, m: string) => void);
    }),
    join: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    triggerUserLeft: () => userLeftListeners.forEach((cb) => cb()),
    triggerUserPublished: (user: unknown, mediaType: string) =>
      userPublishedListeners.forEach((cb) => cb(user, mediaType)),
    // Listener arrays live in the hoisted closure; clearAllMocks() doesn't touch
    // them, so without this they accumulate one stale listener per mounted test.
    resetListeners: () => {
      userLeftListeners.length = 0;
      userPublishedListeners.length = 0;
    },
  };
  const audioTrack = { setMuted: vi.fn(), close: vi.fn() };
  const videoTrack = {
    getMediaStreamTrack: vi.fn(() => ({ enabled: true })),
    play: vi.fn(),
    close: vi.fn(),
  };
  // vi.fn wrappers so a test can make a device fail (e.g. webcam busy).
  const createMicrophoneAudioTrack = vi.fn(async () => audioTrack);
  const createCameraVideoTrack = vi.fn(async () => videoTrack);
  // The mocked AgoraRTC default. The component assigns AgoraRTC.onAutoplayFailed
  // here, so a test can invoke it to simulate a blocked cold-call autoplay.
  const AgoraRTC: {
    createClient: () => typeof client;
    createMicrophoneAudioTrack: typeof createMicrophoneAudioTrack;
    createCameraVideoTrack: typeof createCameraVideoTrack;
    onAutoplayFailed?: () => void;
  } = {
    createClient: () => client,
    createMicrophoneAudioTrack,
    createCameraVideoTrack,
  };
  return {
    client,
    audioTrack,
    videoTrack,
    createMicrophoneAudioTrack,
    createCameraVideoTrack,
    AgoraRTC,
  };
});

vi.mock("agora-rtc-sdk-ng", () => ({ default: agora.AgoraRTC }));

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

describe("VideoCall — stale-closure regression (H1)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    agora.client.resetListeners();
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/answer-video")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ channelName: "ch-test" }),
        });
      }
      if (typeof url === "string" && url.includes("/api/agora/token")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              appId: "app1",
              token: "tok",
              channelName: "ch-test",
              uid: 1001,
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

  it("saves typed roomNumber+notes when guest hangs up (user-left), not stale empty strings", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <VideoCall callId="call-99" onClose={onClose} propertyName="The Sample Hotel" />,
    );

    // Wait until Agora client has joined — all async setup precedes join().
    await waitFor(() => expect(agora.client.join).toHaveBeenCalled());

    // Type room number and notes AFTER setup; this is where the stale-closure
    // bug bit (state updates after the user-left listener was registered).
    const roomInput = screen.getByPlaceholderText("Room #");
    const notesInput = screen.getByPlaceholderText("Notes…");
    await user.type(roomInput, "204");
    await user.type(notesInput, "extra pillows requested");

    // Simulate guest hanging up (Agora user-left).
    await act(async () => {
      agora.client.triggerUserLeft();
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
  // Previously createCameraVideoTrack() threw into the catch → onClose(), so the
  // agent dropped while the guest kept ringing and the call logged as missed.
  it("stays connected audio-only when the camera is busy, instead of abandoning the call", async () => {
    const onClose = vi.fn();
    agora.createCameraVideoTrack.mockRejectedValueOnce(
      new Error("NotReadableError: Could not start video source"),
    );

    render(
      <VideoCall callId="call-busycam" onClose={onClose} propertyName="The Sample Hotel" />,
    );

    // Joined and published despite the camera failure.
    await waitFor(() => expect(agora.client.join).toHaveBeenCalled());
    await waitFor(() => expect(agora.client.publish).toHaveBeenCalled());

    // Published audio only — no camera track.
    expect(agora.client.publish.mock.calls.at(-1)?.[0]).toEqual([agora.audioTrack]);
    // The call was NOT abandoned.
    expect(onClose).not.toHaveBeenCalled();
    // The agent is told they're audio-only.
    expect(screen.getByText(/camera is unavailable/i)).toBeTruthy();
  });

  it("captions the guest audio: captures the remote track and renders the band", async () => {
    render(<VideoCall callId="call-cap" onClose={vi.fn()} propertyName="The Sample Hotel" />);
    await waitFor(() => expect(agora.client.join).toHaveBeenCalled());

    const guestTrack = { kind: "audio" } as unknown as MediaStreamTrack;
    const remoteUser = {
      audioTrack: { play: vi.fn(), getMediaStreamTrack: () => guestTrack },
    };

    await act(async () => {
      agora.client.triggerUserPublished(remoteUser, "audio");
    });

    await waitFor(() => expect(captionsSpy.fn).toHaveBeenCalledWith(guestTrack));
    expect(screen.getByText(/could I get a late checkout/i)).toBeTruthy();
  });

  // Hardening: when the browser blocks the cold first-call autoplay of the guest
  // audio, the recovery must NOT depend on a stray pointer/keydown the agent may
  // never make. Surface a deterministic "Tap to hear guest" control that re-plays
  // on click. (The first-call no-audio symptom.)
  it("surfaces a 'Tap to hear guest' control on blocked autoplay and retries play() on click", async () => {
    const user = userEvent.setup();
    render(<VideoCall callId="call-autoplay" onClose={vi.fn()} propertyName="The Sample Hotel" />);
    await waitFor(() => expect(agora.client.join).toHaveBeenCalled());

    const playFn = vi.fn();
    const remoteUser = {
      audioTrack: { play: playFn, getMediaStreamTrack: () => ({ kind: "audio" }) },
    };
    await act(async () => {
      agora.client.triggerUserPublished(remoteUser, "audio");
    });
    expect(playFn).toHaveBeenCalledTimes(1); // initial play attempt

    // No control while audio is presumed playing.
    expect(screen.queryByRole("button", { name: /tap to hear guest/i })).toBeNull();

    // Agora reports the cold autoplay as blocked.
    await act(async () => {
      agora.AgoraRTC.onAutoplayFailed?.();
    });

    const btn = screen.getByRole("button", { name: /tap to hear guest/i });
    await user.click(btn);

    // play() was retried (>=2: the click handler, plus the gesture backstop) and
    // the control cleared once recovered.
    expect(playFn.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("button", { name: /tap to hear guest/i })).toBeNull();
  });
});
