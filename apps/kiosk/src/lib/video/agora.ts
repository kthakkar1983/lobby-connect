import { joinChannel } from "../agora";
import type { JoinCallbacks, KioskVideoSession, VideoTrackHandle } from "./types";

interface AgoraPlayableTrack {
  play(container: HTMLElement): void;
  getMediaStreamTrack(): MediaStreamTrack;
}

/**
 * Adapter over the UNTOUCHED Agora module (src/lib/agora.ts): wraps its tracks
 * in the provider-agnostic handle (spec D13). detach() is a no-op — matching
 * today's semantics, where nothing detaches Agora players and teardown closes
 * the tracks. Dies with the Agora strip at Phase-4 close.
 */
function agoraHandle(track: AgoraPlayableTrack): VideoTrackHandle {
  return {
    attach: (container) => track.play(container),
    detach: () => {},
    mediaStreamTrack: () => track.getMediaStreamTrack(),
  };
}

export async function joinAgora(
  opts: { appId: string; channel: string; token: string; uid: number } & JoinCallbacks,
): Promise<KioskVideoSession> {
  const session = await joinChannel({
    appId: opts.appId,
    channel: opts.channel,
    token: opts.token,
    uid: opts.uid,
    onRemoteVideo: (t) => opts.onRemoteVideo(t ? agoraHandle(t as unknown as AgoraPlayableTrack) : null),
    onAgentJoined: opts.onAgentJoined,
    onAgentLeft: opts.onAgentLeft,
    onConnectionStateChange: opts.onConnectionStateChange,
  });
  return {
    localVideo: agoraHandle(session.localVideo as unknown as AgoraPlayableTrack),
    localAudioTrack: session.localAudio.getMediaStreamTrack(),
    leave: session.leave,
  };
}
