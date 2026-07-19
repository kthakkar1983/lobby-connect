// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const lk = vi.hoisted(() => {
  const handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  const on = vi.fn((ev: string, cb: (...a: unknown[]) => void) => {
    const list = handlers.get(ev) ?? [];
    list.push(cb);
    handlers.set(ev, list);
    return room;
  });
  const room: Record<string, unknown> = {
    on,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    startAudio: vi.fn(async () => {}),
    canPlaybackAudio: false,
    localParticipant: { publishTrack: vi.fn(async () => {}) },
  };
  const emit = (ev: string, ...a: unknown[]) => handlers.get(ev)?.forEach((cb) => cb(...a));
  const localAudio = {
    mediaStreamTrack: { enabled: true } as MediaStreamTrack,
    mute: vi.fn(async () => {}),
    unmute: vi.fn(async () => {}),
  };
  const localVideo = {
    mediaStreamTrack: { enabled: true } as MediaStreamTrack,
    attach: vi.fn(() => document.createElement("video")),
    detach: vi.fn(() => [] as HTMLMediaElement[]),
  };
  const RoomCtor = vi.fn(function () {
    return room;
  });
  class VideoPreset {
    constructor(
      public width: number,
      public height: number,
      public maxBitrate: number,
      public maxFramerate: number,
    ) {}
  }
  return {
    room,
    emit,
    reset: () => handlers.clear(),
    localAudio,
    localVideo,
    createLocalAudioTrack: vi.fn(async () => localAudio),
    createLocalVideoTrack: vi.fn(async () => localVideo),
    RoomEvent: {
      TrackSubscribed: "trackSubscribed",
      ParticipantDisconnected: "participantDisconnected",
      AudioPlaybackStatusChanged: "audioPlaybackChanged",
      Disconnected: "disconnected",
    },
    Track: { Kind: { Video: "video", Audio: "audio" } },
    // Numeric TS enum, so the real one carries a reverse mapping the session
    // relies on to name the reason. Values match @livekit/protocol 1.49.0.
    DisconnectReason: {
      CLIENT_INITIATED: 1,
      SIGNAL_CLOSE: 9,
      1: "CLIENT_INITIATED",
      9: "SIGNAL_CLOSE",
    },
    RoomCtor,
    VideoPreset,
  };
});

vi.mock("livekit-client", () => ({
  Room: lk.RoomCtor,
  RoomEvent: lk.RoomEvent,
  Track: lk.Track,
  DisconnectReason: lk.DisconnectReason,
  VideoPreset: lk.VideoPreset,
  createLocalAudioTrack: lk.createLocalAudioTrack,
  createLocalVideoTrack: lk.createLocalVideoTrack,
}));

const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage }));

import { joinLiveKitCall } from "@/lib/video/livekit-session";

function callbacks() {
  return {
    onRemoteVideo: vi.fn(),
    onRemoteAudioTrack: vi.fn(),
    onAudioBlocked: vi.fn(),
    onGuestLeft: vi.fn(),
  };
}

describe("joinLiveKitCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lk.reset();
    lk.createLocalAudioTrack.mockResolvedValue(lk.localAudio);
    lk.createLocalVideoTrack.mockResolvedValue(lk.localVideo);
  });

  it("publishes mic first, then camera; exposes local handles + no warning", async () => {
    const s = await joinLiveKitCall({ url: "wss://x", token: "t", ...callbacks() });
    const publish = (lk.room.localParticipant as { publishTrack: ReturnType<typeof vi.fn> }).publishTrack;
    expect(publish).toHaveBeenNthCalledWith(1, lk.localAudio);
    expect(publish).toHaveBeenNthCalledWith(2, lk.localVideo);
    expect(s.mediaWarning).toBeNull();
    expect(s.localVideo).not.toBeNull();
    expect(s.localAudioMediaTrack).toBe(lk.localAudio.mediaStreamTrack);
  });

  it("BUSY WEBCAM: camera failure -> audio-only, localVideo null, warning 'camera', call proceeds", async () => {
    lk.createLocalVideoTrack.mockRejectedValue(Object.assign(new Error("busy"), { name: "NotReadableError" }));
    const s = await joinLiveKitCall({ url: "wss://x", token: "t", ...callbacks() });
    const publish = (lk.room.localParticipant as { publishTrack: ReturnType<typeof vi.fn> }).publishTrack;
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(lk.localAudio);
    expect(s.localVideo).toBeNull();
    expect(s.mediaWarning).toBe("camera");
  });

  it("mic failure -> warning 'mic'; both fail -> 'both' and nothing published", async () => {
    lk.createLocalAudioTrack.mockRejectedValue(new Error("denied"));
    const s1 = await joinLiveKitCall({ url: "wss://x", token: "t", ...callbacks() });
    expect(s1.mediaWarning).toBe("mic");
    lk.createLocalVideoTrack.mockRejectedValue(new Error("busy"));
    const s2 = await joinLiveKitCall({ url: "wss://x", token: "t", ...callbacks() });
    expect(s2.mediaWarning).toBe("both");
  });

  it("remote video -> handle; remote audio -> attach + raw track to captions tap", async () => {
    const cb = callbacks();
    await joinLiveKitCall({ url: "wss://x", token: "t", ...cb });
    const vid = { kind: "video", attach: vi.fn(() => document.createElement("video")), detach: vi.fn(() => []), mediaStreamTrack: {} as MediaStreamTrack };
    const aud = { kind: "audio", attach: vi.fn(() => document.createElement("audio")), detach: vi.fn(() => []), mediaStreamTrack: { id: "guest-audio" } as unknown as MediaStreamTrack };
    lk.emit("trackSubscribed", vid);
    lk.emit("trackSubscribed", aud);
    expect(cb.onRemoteVideo).toHaveBeenCalledTimes(1);
    expect(aud.attach).toHaveBeenCalled();
    expect(cb.onRemoteAudioTrack).toHaveBeenCalledWith(aud.mediaStreamTrack);
  });

  it("blocked playback -> onAudioBlocked with a recover fn that calls startAudio", async () => {
    const cb = callbacks();
    await joinLiveKitCall({ url: "wss://x", token: "t", ...cb });
    lk.emit("audioPlaybackChanged");
    expect(cb.onAudioBlocked).toHaveBeenCalledTimes(1);
    (cb.onAudioBlocked.mock.calls[0]![0] as () => void)();
    expect(lk.room.startAudio).toHaveBeenCalled();
  });

  it("guest left -> onGuestLeft; setMicMuted drives mute/unmute; leave disconnects", async () => {
    const cb = callbacks();
    const s = await joinLiveKitCall({ url: "wss://x", token: "t", ...cb });
    lk.emit("participantDisconnected");
    expect(cb.onGuestLeft).toHaveBeenCalledTimes(1);
    await s.setMicMuted(true);
    expect(lk.localAudio.mute).toHaveBeenCalled();
    await s.setMicMuted(false);
    expect(lk.localAudio.unmute).toHaveBeenCalled();
    await s.leave();
    expect(lk.room.disconnect).toHaveBeenCalled();
  });

  describe("unexpected disconnect reporting (spec 8 / D14)", () => {
    it("reports an unexpected disconnect to Sentry, named and with page visibility", async () => {
      await joinLiveKitCall({ url: "wss://x", token: "t", ...callbacks() });
      lk.emit("disconnected", lk.DisconnectReason.SIGNAL_CLOSE);
      expect(captureMessage).toHaveBeenCalledTimes(1);
      expect(captureMessage.mock.calls[0]![1]).toMatchObject({
        level: "warning",
        extra: { reason: "SIGNAL_CLOSE", visibility: "visible" },
      });
    });

    it("stays silent when the app called leave()", async () => {
      const s = await joinLiveKitCall({ url: "wss://x", token: "t", ...callbacks() });
      await s.leave();
      lk.emit("disconnected", lk.DisconnectReason.CLIENT_INITIATED);
      // Our own teardown is not an incident.
      expect(captureMessage).not.toHaveBeenCalled();
    });

    // THE regression guard. livekit-client disconnects the room ITSELF on a
    // main-window pagehide/beforeunload/freeze, and reports that as
    // CLIENT_INITIATED -- identical to the reason our own leave() produces.
    // Filtering on the reason instead of on our own flag would silence exactly
    // the bug this handler exists to catch. Do not "simplify" it that way.
    it("reports a CLIENT_INITIATED disconnect we did NOT ask for", async () => {
      await joinLiveKitCall({ url: "wss://x", token: "t", ...callbacks() });
      lk.emit("disconnected", lk.DisconnectReason.CLIENT_INITIATED);
      expect(captureMessage).toHaveBeenCalledTimes(1);
      expect(captureMessage.mock.calls[0]![1]).toMatchObject({
        extra: { reason: "CLIENT_INITIATED" },
      });
    });

    it("falls back to the raw code for a reason the enum does not name", async () => {
      await joinLiveKitCall({ url: "wss://x", token: "t", ...callbacks() });
      lk.emit("disconnected", 99);
      expect(captureMessage.mock.calls[0]![1]).toMatchObject({ extra: { reason: "99" } });
    });

    it("falls back to 'unknown' when no reason is supplied", async () => {
      await joinLiveKitCall({ url: "wss://x", token: "t", ...callbacks() });
      lk.emit("disconnected", undefined);
      expect(captureMessage.mock.calls[0]![1]).toMatchObject({ extra: { reason: "unknown" } });
    });
  });

  it("applies the shared H.264 tuning to the room + capture", async () => {
    await joinLiveKitCall({ url: "u", token: "t", ...callbacks() });
    expect(lk.RoomCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        publishDefaults: expect.objectContaining({ videoCodec: "h264" }),
      }),
    );
    expect(lk.createLocalVideoTrack).toHaveBeenCalledWith({
      resolution: { width: 1920, height: 1080 },
    });
  });
});
