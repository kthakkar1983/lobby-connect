import type {
  IAgoraRTCClient,
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
  IAgoraRTCRemoteUser,
} from "agora-rtc-sdk-ng";

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
}): Promise<KioskAgoraSession> {
  const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
  const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

  client.on("user-published", async (user, mediaType) => {
    await client.subscribe(user, mediaType);
    if (mediaType === "video") opts.onRemoteVideo(user.videoTrack);
    if (mediaType === "audio") user.audioTrack?.play();
    opts.onAgentJoined();
  });
  client.on("user-left", () => opts.onAgentLeft());

  await client.join(opts.appId, opts.channel, opts.token, opts.uid);
  const localAudio = await AgoraRTC.createMicrophoneAudioTrack();
  const localVideo = await AgoraRTC.createCameraVideoTrack();
  await client.publish([localAudio, localVideo]);

  return {
    client,
    localVideo,
    localAudio,
    leave: async () => {
      localAudio.close();
      localVideo.close();
      await client.leave();
    },
  };
}
