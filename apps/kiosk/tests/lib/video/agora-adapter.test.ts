import { describe, it, expect, vi, beforeEach } from "vitest";

const agora = vi.hoisted(() => ({ joinChannel: vi.fn() }));
vi.mock("@/lib/agora", () => agora);

import { joinAgora } from "@/lib/video/agora";

function fakeAgoraTrack() {
  return { play: vi.fn(), getMediaStreamTrack: vi.fn(() => ({ enabled: true }) as MediaStreamTrack) };
}

describe("joinAgora adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes join args through and wraps tracks in handles", async () => {
    const localVideo = fakeAgoraTrack();
    const localAudio = fakeAgoraTrack();
    agora.joinChannel.mockResolvedValue({ localVideo, localAudio, leave: vi.fn(), client: {} });
    const onRemoteVideo = vi.fn();
    const session = await joinAgora({
      appId: "a", channel: "c", token: "t", uid: 7,
      onRemoteVideo, onAgentJoined: vi.fn(), onAgentLeft: vi.fn(), onConnectionStateChange: vi.fn(),
    });
    expect(agora.joinChannel).toHaveBeenCalledWith(
      expect.objectContaining({ appId: "a", channel: "c", token: "t", uid: 7 }),
    );
    // local video handle delegates to Agora's play(el)
    const container = {} as HTMLElement;
    session.localVideo.attach(container);
    expect(localVideo.play).toHaveBeenCalledWith(container);
    expect(session.localAudioTrack).toEqual({ enabled: true });
    // remote wrap: invoke the adapter's onRemoteVideo with an agora track
    const passed = agora.joinChannel.mock.calls[0]![0] as { onRemoteVideo: (t: unknown) => void };
    const remote = fakeAgoraTrack();
    passed.onRemoteVideo(remote);
    const handle = onRemoteVideo.mock.calls[0]![0] as { attach(c: HTMLElement): void };
    handle.attach(container);
    expect(remote.play).toHaveBeenCalledWith(container);
    // null passthrough
    passed.onRemoteVideo(null);
    expect(onRemoteVideo).toHaveBeenLastCalledWith(null);
  });
});
