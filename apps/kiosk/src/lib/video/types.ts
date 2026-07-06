/**
 * Provider-agnostic video seam (Phase 4, spec D13). Screens and App consume
 * ONLY these shapes; the agora/livekit modules produce them. The handle
 * normalizes the one provider-typed thing screens used to touch:
 * Agora `track.play(el)` vs LiveKit `track.attach()`.
 */
export interface VideoTrackHandle {
  /** Render this track inside the given container element. */
  attach(container: HTMLElement): void;
  /** Remove any elements this handle attached. */
  detach(): void;
  /** Raw W3C track (mute/camera toggles flip `.enabled`), null if unavailable. */
  mediaStreamTrack(): MediaStreamTrack | null;
}

export interface KioskVideoSession {
  localVideo: VideoTrackHandle;
  localAudioTrack: MediaStreamTrack;
  leave(): Promise<void>;
}

export interface JoinCallbacks {
  onRemoteVideo(handle: VideoTrackHandle | null): void;
  onAgentJoined(): void;
  onAgentLeft(): void;
  onConnectionStateChange(current: string, previous: string, reason?: string): void;
}
