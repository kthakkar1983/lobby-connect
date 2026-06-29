import * as Sentry from "@sentry/react";
import type {
  IAgoraRTCClient,
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
  IAgoraRTCRemoteUser,
  IRemoteAudioTrack,
} from "agora-rtc-sdk-ng";
import { recoverAudioOnNextGesture } from "./audio-unlock";

export interface KioskAgoraSession {
  client: IAgoraRTCClient;
  localVideo: ICameraVideoTrack;
  localAudio: IMicrophoneAudioTrack;
  leave: () => Promise<void>;
}

/** Join a channel, publish camera+mic, and wire remote-user callbacks. Dynamic import (SSR/test safe). */
export async function joinChannel(opts: {
  appId: string;
  channel: string;
  token: string;
  uid: number;
  onRemoteVideo: (track: IAgoraRTCRemoteUser["videoTrack"]) => void;
  onAgentJoined: () => void;
  onAgentLeft: () => void;
  onConnectionStateChange: (current: string, previous: string, reason?: string) => void;
}): Promise<KioskAgoraSession> {
  const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
  const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

  // The agent's remote audio track, kept so a blocked autoplay can be re-played
  // on the guest's next interaction — no "tap to hear" prompt on the kiosk.
  let remoteAudio: IRemoteAudioTrack | null = null;
  AgoraRTC.onAutoplayFailed = () => {
    Sentry.addBreadcrumb({
      category: "agora",
      level: "warning",
      message: "remote audio autoplay blocked; recovering on next interaction",
    });
    recoverAudioOnNextGesture(() => void remoteAudio?.play());
  };

  client.on("user-published", async (user, mediaType) => {
    await client.subscribe(user, mediaType);
    if (mediaType === "video") {
      opts.onRemoteVideo(user.videoTrack);
      // Fire "agent present" once, on video — not on each published track.
      opts.onAgentJoined();
    }
    if (mediaType === "audio") {
      remoteAudio = user.audioTrack ?? null;
      user.audioTrack?.play();
    }
  });
  client.on("user-left", () => opts.onAgentLeft());
  client.on("connection-state-change", (cur, prev, reason) =>
    opts.onConnectionStateChange(cur, prev, reason),
  );

  await client.join(opts.appId, opts.channel, opts.token, opts.uid);
  // Publish the mic the instant it's ready, BEFORE acquiring the camera. The
  // first-call `createCameraVideoTrack()` pays a cold device warm-up (and a
  // permission prompt on a fresh device) that can run for seconds; bundling
  // audio+video into one publish gated the guest's voice behind that delay, so
  // the agent heard nothing until the camera came up. Mic-first decouples them.
  const tJoined = performance.now();
  const localAudio = await AgoraRTC.createMicrophoneAudioTrack();
  await client.publish(localAudio);
  const tAudioPublished = performance.now();
  const localVideo = await AgoraRTC.createCameraVideoTrack();
  await client.publish(localVideo);
  // TEMPORARY DIAGNOSTIC — quantify how much the camera warm-up delayed audio.
  // (Remove with the agent-side probe once the no-audio cause is pinned.) The
  // camWarmup bucket is in the message so it reads straight from the issue list.
  if (!import.meta.env.DEV) {
    const micToPublishMs = Math.round(tAudioPublished - tJoined);
    const camToPublishMs = Math.round(performance.now() - tAudioPublished);
    Sentry.captureMessage(
      `DIAG kiosk-publish: camWarmup=${camToPublishMs > 1500 ? "SLOW" : "fast"}`,
      { level: "warning", extra: { micToPublishMs, camToPublishMs } },
    );
  }

  return {
    client,
    localVideo,
    localAudio,
    leave: async () => {
      localAudio.close();
      localVideo.close();
      // A leave during a network drop can reject (already disconnected) — the
      // session is over either way, so swallow it.
      try {
        await client.leave();
      } catch {
        /* already disconnected */
      }
    },
  };
}
