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
    },
    Track: { Kind: { Video: "video", Audio: "audio" } },
  };
});

vi.mock("livekit-client", () => ({
  Room: vi.fn(function () { return lk.room; }),
  RoomEvent: lk.RoomEvent,
  Track: lk.Track,
  createLocalAudioTrack: lk.createLocalAudioTrack,
  createLocalVideoTrack: lk.createLocalVideoTrack,
}));

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
});
