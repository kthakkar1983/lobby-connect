/**
 * Provider-agnostic video seam (Phase 4, spec D13). Screens and App consume
 * ONLY these shapes; the livekit module produces them. The handle exists so a
 * future second provider can be dropped in without screens/App touching a
 * provider-typed track API directly (today: LiveKit `track.attach()`).
 */
export interface VideoTrackHandle {
  /**
   * Render this track inside the given container element. MAY be called again
   * on a new container (screens re-attach across remounts, e.g. Ringing ->
   * Connected): each call appends a fresh element; prior elements leave the
   * page with their unmounted containers.
   */
  attach(container: HTMLElement): void;
  /** Remove EVERY element this handle attached. Idempotent. */
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
