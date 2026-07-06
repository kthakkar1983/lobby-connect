"use client";

import type { RemoteTrack } from "livekit-client";

export interface PortalVideoHandle {
  attach(container: HTMLElement): void;
  detach(): void;
  mediaStreamTrack(): MediaStreamTrack | null;
}

export interface LiveKitCallSession {
  localVideo: PortalVideoHandle | null;
  localAudioMediaTrack: MediaStreamTrack | null;
  mediaWarning: "camera" | "mic" | "both" | null;
  setMicMuted(muted: boolean): Promise<void>;
  leave(): Promise<void>;
}

export interface LiveKitCallCallbacks {
  onRemoteVideo(handle: PortalVideoHandle): void;
  /** Raw W3C track for the captions tap (same object family as Agora's getMediaStreamTrack()). */
  onRemoteAudioTrack(track: MediaStreamTrack): void;
  /** Fired when the browser blocks remote-audio autoplay; recover() = room.startAudio(). */
  onAudioBlocked(recover: () => void): void;
  onGuestLeft(): void;
}

interface AttachableTrack {
  attach(): HTMLMediaElement;
  detach(): HTMLMediaElement[];
  mediaStreamTrack: MediaStreamTrack;
}

function handleFor(track: AttachableTrack, opts?: { mirror?: boolean }): PortalVideoHandle {
  return {
    attach(container: HTMLElement) {
      const el = track.attach() as HTMLVideoElement;
      el.style.width = "100%";
      el.style.height = "100%";
      el.style.objectFit = "cover";
      if (opts?.mirror) el.style.transform = "scaleX(-1)";
      container.appendChild(el);
    },
    detach() {
      track.detach().forEach((el) => el.remove());
    },
    mediaStreamTrack: () => track.mediaStreamTrack,
  };
}

/**
 * The portal's LiveKit leg (Phase 4, spec §4.2) — the provider sibling of the
 * Agora code inside video-call.tsx. Behavior parity requirements it owns:
 * mic-first publish; INDEPENDENT device acquisition (a busy webcam — e.g.
 * NotReadableError — must NOT abandon the call: connect audio-only and report
 * mediaWarning, mirroring the Agora branch's resilient-acquire block).
 */
export async function joinLiveKitCall(
  opts: { url: string; token: string } & LiveKitCallCallbacks,
): Promise<LiveKitCallSession> {
  const { Room, RoomEvent, Track, createLocalAudioTrack, createLocalVideoTrack } =
    await import("livekit-client");

  const room = new Room();
  const remoteAudioEls: HTMLMediaElement[] = [];

  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Video) {
      opts.onRemoteVideo(handleFor(track as unknown as AttachableTrack));
    }
    if (track.kind === Track.Kind.Audio) {
      remoteAudioEls.push(track.attach());
      opts.onRemoteAudioTrack((track as unknown as AttachableTrack).mediaStreamTrack);
    }
  });
  room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (!room.canPlaybackAudio) opts.onAudioBlocked(() => void room.startAudio());
  });
  room.on(RoomEvent.ParticipantDisconnected, () => opts.onGuestLeft());

  await room.connect(opts.url, opts.token);

  // Acquire mic + camera INDEPENDENTLY and resiliently (parity with the Agora
  // branch): join with whatever media is available so the guest always connects.
  let audio: Awaited<ReturnType<typeof createLocalAudioTrack>> | null = null;
  let video: Awaited<ReturnType<typeof createLocalVideoTrack>> | null = null;
  try {
    audio = await createLocalAudioTrack();
    await room.localParticipant.publishTrack(audio);
  } catch {
    audio = null;
  }
  try {
    video = await createLocalVideoTrack();
    await room.localParticipant.publishTrack(video);
  } catch {
    video = null;
  }

  return {
    localVideo: video ? handleFor(video as unknown as AttachableTrack, { mirror: true }) : null,
    localAudioMediaTrack: audio ? audio.mediaStreamTrack : null,
    mediaWarning: !audio && !video ? "both" : !audio ? "mic" : !video ? "camera" : null,
    setMicMuted: async (muted) => {
      if (!audio) return;
      if (muted) await audio.mute();
      else await audio.unmute();
    },
    leave: async () => {
      for (const el of remoteAudioEls) {
        el.pause();
        (el as HTMLMediaElement & { srcObject: unknown }).srcObject = null;
      }
      try {
        await room.disconnect();
      } catch {
        /* already disconnected */
      }
    },
  };
}
