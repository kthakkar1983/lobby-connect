import * as Sentry from "@sentry/react";
import type { RemoteTrack } from "livekit-client";
import { buildLiveKitVideoOptions } from "@lc/shared";
import { recoverAudioOnNextGesture } from "../audio-unlock";
import type { JoinCallbacks, KioskVideoSession, VideoTrackHandle } from "./types";

// Internal: the structural surface of LiveKit's Track that the handle needs
// (matched by RemoteTrack + LocalTrack) — not a real livekit-client type.
interface AttachableTrack {
  attach(): HTMLMediaElement;
  detach(): HTMLMediaElement[];
  mediaStreamTrack: MediaStreamTrack;
}

/**
 * Wrap a LiveKit track in the provider-agnostic handle (spec D13). attach()
 * lets the SDK create the element (it sets playsInline/autoplay itself, incl.
 * the Safari quirk), styles it to fill the container, and appends it. `mirror`
 * flips the LOCAL self-view horizontally, matching a front-camera selfie view.
 */
function liveKitHandle(track: AttachableTrack, opts?: { mirror?: boolean }): VideoTrackHandle {
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
 * The kiosk's video-provider adapter — implements the JoinCallbacks contract
 * (see lib/video/types.ts), chosen by the /api/video/token provider field.
 * Dynamic-imports the SDK so it's only ever pulled into the bundle when a call
 * actually starts. Connection events are translated into the kiosk's own
 * vocabulary so interpretConnectionState + App.tsx stay provider-agnostic:
 * Reconnecting -> RECONNECTING, Reconnected -> CONNECTED, Disconnected
 * (CLIENT_INITIATED, i.e. our own leave()) -> "LEAVE" (inert — a normal
 * hang-up, already handled); any other disconnect reason is terminal.
 */
export async function joinLiveKit(
  opts: { url: string; token: string } & JoinCallbacks,
): Promise<KioskVideoSession> {
  const { Room, RoomEvent, Track, DisconnectReason, createLocalAudioTrack, createLocalVideoTrack } =
    await import("livekit-client");

  const { roomOptions, captureOptions } = buildLiveKitVideoOptions();
  const room = new Room(roomOptions);
  let agentJoinedFired = false;
  // Agent-audio playback elements (never in the DOM — audio needs no layout);
  // kept ONLY so leave() can stop playback + drop srcObject refs.
  const remoteAudioEls: HTMLMediaElement[] = [];

  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Video) {
      opts.onRemoteVideo(liveKitHandle(track as unknown as AttachableTrack));
      // Fire "agent present" once, on video — not on each subscribed track.
      if (!agentJoinedFired) {
        agentJoinedFired = true;
        opts.onAgentJoined();
      }
    }
    if (track.kind === Track.Kind.Audio) {
      // Audio needs no layout: the element plays without DOM insertion.
      remoteAudioEls.push(track.attach());
    }
  });

  room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (!room.canPlaybackAudio) {
      Sentry.addBreadcrumb({
        category: "livekit",
        level: "warning",
        message: "remote audio autoplay blocked; recovering on next interaction",
      });
      recoverAudioOnNextGesture(() => void room.startAudio());
    }
  });

  room.on(RoomEvent.ParticipantDisconnected, () => opts.onAgentLeft());
  room.on(RoomEvent.Reconnecting, () => opts.onConnectionStateChange("RECONNECTING", "CONNECTED"));
  room.on(RoomEvent.Reconnected, () => opts.onConnectionStateChange("CONNECTED", "RECONNECTING"));
  room.on(RoomEvent.Disconnected, (reason?: number) => {
    const isLeave = reason === DisconnectReason.CLIENT_INITIATED;
    opts.onConnectionStateChange("DISCONNECTED", "CONNECTED", isLeave ? "LEAVE" : String(reason ?? "UNKNOWN"));
  });
  room.on(RoomEvent.DataReceived, (payload, participant) => {
    opts.onData?.(payload, participant?.identity ?? "");
  });

  await room.connect(opts.url, opts.token);

  // Mic FIRST, camera second: the camera's cold warm-up (seconds, plus a
  // permission prompt on a fresh device) must not gate the guest's voice, so
  // publish audio the instant it's ready and only then acquire video. A camera
  // failure throws out of joinLiveKit -> App's catch -> apology (the kiosk
  // REQUIRES a camera; it is the guest's face).
  const localAudio = await createLocalAudioTrack();
  await room.localParticipant.publishTrack(localAudio);
  const localVideo = await createLocalVideoTrack(captureOptions);
  await room.localParticipant.publishTrack(localVideo);

  return {
    localVideo: liveKitHandle(localVideo as unknown as AttachableTrack, { mirror: true }),
    localAudioTrack: localAudio.mediaStreamTrack,
    leave: async () => {
      for (const el of remoteAudioEls) {
        el.pause();
        (el as HTMLMediaElement & { srcObject: unknown }).srcObject = null;
      }
      // A disconnect during a network drop can reject — session is over either way.
      try {
        await room.disconnect();
      } catch {
        /* already disconnected */
      }
    },
    sendData: (bytes, reliable) => void room.localParticipant.publishData(bytes, { reliable }),
  };
}
