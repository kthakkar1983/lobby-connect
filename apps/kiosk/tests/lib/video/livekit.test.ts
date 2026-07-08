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
  const mkVideoEl = () => document.createElement("video");
  const localAudio = { mediaStreamTrack: { enabled: true } as MediaStreamTrack };
  const localVideo = {
    mediaStreamTrack: { enabled: true } as MediaStreamTrack,
    attach: vi.fn(() => mkVideoEl()),
    detach: vi.fn(() => [] as HTMLMediaElement[]),
  };
  const RoomEvent = {
    TrackSubscribed: "trackSubscribed",
    ParticipantDisconnected: "participantDisconnected",
    Disconnected: "disconnected",
    Reconnecting: "reconnecting",
    Reconnected: "reconnected",
    AudioPlaybackStatusChanged: "audioPlaybackChanged",
  };
  const Track = { Kind: { Video: "video", Audio: "audio" } };
  const DisconnectReason = { CLIENT_INITIATED: 1 };
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
    RoomEvent,
    Track,
    DisconnectReason,
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

const recover = vi.hoisted(() => ({ recoverAudioOnNextGesture: vi.fn() }));
vi.mock("@/lib/audio-unlock", () => recover);
vi.mock("@sentry/react", () => ({ addBreadcrumb: vi.fn(), captureMessage: vi.fn() }));

import { joinLiveKit } from "@/lib/video/livekit";

function callbacks() {
  return {
    onRemoteVideo: vi.fn(),
    onAgentJoined: vi.fn(),
    onAgentLeft: vi.fn(),
    onConnectionStateChange: vi.fn(),
  };
}

function remoteVideoTrack() {
  return {
    kind: "video",
    attach: vi.fn(() => document.createElement("video")),
    detach: vi.fn(() => [] as HTMLMediaElement[]),
    mediaStreamTrack: { enabled: true } as MediaStreamTrack,
  };
}
function remoteAudioTrack() {
  return {
    kind: "audio",
    attach: vi.fn(() => document.createElement("audio")),
    detach: vi.fn(() => [] as HTMLMediaElement[]),
    mediaStreamTrack: { enabled: true } as MediaStreamTrack,
  };
}

describe("joinLiveKit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lk.reset();
    (lk.room as { canPlaybackAudio: boolean }).canPlaybackAudio = false;
  });

  it("connects then publishes MIC FIRST, camera second (cold-camera fix preserved)", async () => {
    const cb = callbacks();
    await joinLiveKit({ url: "wss://x", token: "t", ...cb });
    const publish = (lk.room.localParticipant as { publishTrack: ReturnType<typeof vi.fn> }).publishTrack;
    expect(publish).toHaveBeenNthCalledWith(1, lk.localAudio);
    expect(publish).toHaveBeenNthCalledWith(2, lk.localVideo);
    expect(lk.createLocalAudioTrack.mock.invocationCallOrder[0]).toBeLessThan(
      lk.createLocalVideoTrack.mock.invocationCallOrder[0]!,
    );
  });

  it("remote VIDEO subscribe -> onRemoteVideo handle + onAgentJoined exactly once", async () => {
    const cb = callbacks();
    await joinLiveKit({ url: "wss://x", token: "t", ...cb });
    lk.emit("trackSubscribed", remoteVideoTrack());
    lk.emit("trackSubscribed", remoteVideoTrack());
    expect(cb.onRemoteVideo).toHaveBeenCalledTimes(2);
    expect(cb.onAgentJoined).toHaveBeenCalledTimes(1);
    const handle = cb.onRemoteVideo.mock.calls[0]![0] as { attach(c: HTMLElement): void };
    const container = document.createElement("div");
    handle.attach(container);
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("remote AUDIO subscribe attaches a playback element (no DOM insert needed)", async () => {
    const cb = callbacks();
    await joinLiveKit({ url: "wss://x", token: "t", ...cb });
    const audio = remoteAudioTrack();
    lk.emit("trackSubscribed", audio);
    expect(audio.attach).toHaveBeenCalled();
    expect(cb.onAgentJoined).not.toHaveBeenCalled(); // agent-present fires on VIDEO only (parity)
  });

  it("blocked audio playback wires the gesture recovery to room.startAudio", async () => {
    const cb = callbacks();
    await joinLiveKit({ url: "wss://x", token: "t", ...cb });
    lk.emit("audioPlaybackChanged");
    expect(recover.recoverAudioOnNextGesture).toHaveBeenCalledTimes(1);
    (recover.recoverAudioOnNextGesture.mock.calls[0]![0] as () => void)();
    expect(lk.room.startAudio).toHaveBeenCalled();
  });

  it("ParticipantDisconnected -> onAgentLeft", async () => {
    const cb = callbacks();
    await joinLiveKit({ url: "wss://x", token: "t", ...cb });
    lk.emit("participantDisconnected");
    expect(cb.onAgentLeft).toHaveBeenCalledTimes(1);
  });

  it("maps connection events into the kiosk vocabulary (interpretConnectionState contract)", async () => {
    const cb = callbacks();
    await joinLiveKit({ url: "wss://x", token: "t", ...cb });
    lk.emit("reconnecting");
    expect(cb.onConnectionStateChange).toHaveBeenLastCalledWith("RECONNECTING", "CONNECTED");
    lk.emit("reconnected");
    expect(cb.onConnectionStateChange).toHaveBeenLastCalledWith("CONNECTED", "RECONNECTING");
    lk.emit("disconnected", lk.DisconnectReason.CLIENT_INITIATED);
    expect(cb.onConnectionStateChange).toHaveBeenLastCalledWith("DISCONNECTED", "CONNECTED", "LEAVE");
    lk.emit("disconnected", 99);
    expect(cb.onConnectionStateChange).toHaveBeenLastCalledWith("DISCONNECTED", "CONNECTED", "99");
  });

  it("session exposes local handles + leave() disconnects", async () => {
    const cb = callbacks();
    const session = await joinLiveKit({ url: "wss://x", token: "t", ...cb });
    expect(session.localAudioTrack).toBe(lk.localAudio.mediaStreamTrack);
    const container = document.createElement("div");
    session.localVideo.attach(container);
    expect(container.querySelector("video")).not.toBeNull();
    await session.leave();
    expect(lk.room.disconnect).toHaveBeenCalled();
  });

  it("applies the shared H.264 tuning to the room + capture", async () => {
    const cb = callbacks();
    await joinLiveKit({ url: "wss://x", token: "t", ...cb });
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
