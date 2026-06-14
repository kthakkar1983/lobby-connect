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
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// vi.hoisted: variables created here are available inside vi.mock() factories,
// which are hoisted before top-level module code.
const agora = vi.hoisted(() => {
  const userLeftListeners: Array<() => void> = [];
  const client = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === "user-left") userLeftListeners.push(cb as () => void);
    }),
    join: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    triggerUserLeft: () => userLeftListeners.forEach((cb) => cb()),
  };
  const audioTrack = { setMuted: vi.fn(), close: vi.fn() };
  const videoTrack = {
    getMediaStreamTrack: vi.fn(() => ({ enabled: true })),
    play: vi.fn(),
    close: vi.fn(),
  };
  return { client, audioTrack, videoTrack };
});

vi.mock("agora-rtc-sdk-ng", () => ({
  default: {
    createClient: () => agora.client,
    createMicrophoneAudioTrack: async () => agora.audioTrack,
    createCameraVideoTrack: async () => agora.videoTrack,
  },
}));

// Stub PlaybookPanel to prevent its own fetch calls from polluting assertions.
vi.mock("@/components/call/playbook-panel", () => ({
  PlaybookPanel: () => null,
}));

import { VideoCall } from "@/components/video-call/video-call";

describe("VideoCall — stale-closure regression (H1)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
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
});
