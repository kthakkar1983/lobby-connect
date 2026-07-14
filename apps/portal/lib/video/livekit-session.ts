"use client";

import type { RemoteTrack } from "livekit-client";
import { buildLiveKitVideoOptions } from "@lc/shared";

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
  sendData(bytes: Uint8Array, reliable: boolean): void; // chat data channel (in-call kiosk<->agent chat)
}

/**
 * Deliberately NARROWER than the kiosk's JoinCallbacks: no connection-state
 * callback. The portal has never had connection-state UI on EITHER provider —
 * its teardown paths are guest-left, the agent's End button, and the
 * multi-owner finalization backstops (kiosk + reaper). The kiosk is the side
 * with the Reconnecting overlay, hence its extra vocabulary mapping.
 */
export interface LiveKitCallCallbacks {
  onRemoteVideo(handle: PortalVideoHandle): void;
  /** Raw W3C REMOTE AUDIO track for the captions tap (a standard MediaStreamTrack). */
  onRemoteAudioTrack(track: MediaStreamTrack): void;
  /** Fired when the browser blocks remote-audio autoplay; recover() = room.startAudio(). */
  onAudioBlocked(recover: () => void): void;
  onGuestLeft(): void;
  /** Inbound data-channel payload (chat). fromIdentity is the LiveKit participant identity ("kiosk" or "agent-<id>"). */
  onData?(bytes: Uint8Array, fromIdentity: string): void;
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
 * The portal's LiveKit leg (Phase 4, spec §4.2), consumed by video-call.tsx.
 * Behavior requirements it owns: mic-first publish; INDEPENDENT device
 * acquisition (a busy webcam — e.g. NotReadableError — must NOT abandon the
 * call: connect audio-only and report mediaWarning).
 */
export async function joinLiveKitCall(
  opts: { url: string; token: string } & LiveKitCallCallbacks,
): Promise<LiveKitCallSession> {
  const { Room, RoomEvent, Track, createLocalAudioTrack, createLocalVideoTrack } =
    await import("livekit-client");

  const { roomOptions, captureOptions } = buildLiveKitVideoOptions();
  const room = new Room(roomOptions);
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
  room.on(RoomEvent.DataReceived, (payload, participant) => {
    opts.onData?.(payload, participant?.identity ?? "");
  });

  await room.connect(opts.url, opts.token);

  // Acquire mic + camera INDEPENDENTLY and resiliently: join with whatever
  // media is available so the guest always connects.
  let audio: Awaited<ReturnType<typeof createLocalAudioTrack>> | null = null;
  let video: Awaited<ReturnType<typeof createLocalVideoTrack>> | null = null;
  try {
    audio = await createLocalAudioTrack();
    await room.localParticipant.publishTrack(audio);
  } catch {
    audio = null;
  }
  try {
    video = await createLocalVideoTrack(captureOptions);
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
    sendData: (bytes, reliable) => void room.localParticipant.publishData(bytes, { reliable }),
  };
}
