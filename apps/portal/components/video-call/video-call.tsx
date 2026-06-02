"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff } from "lucide-react";
import type {
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
  IRemoteVideoTrack,
} from "agora-rtc-sdk-ng";
import { PlaybookPanel } from "./playbook-panel";

export function VideoCall({ callId, onClose }: { callId: string; onClose: () => void }) {
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [roomNumber, setRoomNumber] = useState("");
  const [notes, setNotes] = useState("");
  const remoteRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const audioRef = useRef<IMicrophoneAudioTrack | null>(null);
  const videoRef = useRef<ICameraVideoTrack | null>(null);

  // Accept the call, then join Agora.
  // NOTE: the cleanup must tear down the client/tracks, and we must bail on
  // `cancelled` after each await. React StrictMode (dev) mounts effects twice;
  // without this, the first run still joins + publishes and is then abandoned —
  // leaking a second publisher whose audio is never muted. Local (not ref) vars
  // are used in cleanup because a second mount overwrites the refs.
  useEffect(() => {
    let cancelled = false;
    let client: IAgoraRTCClient | null = null;
    let audio: IMicrophoneAudioTrack | null = null;
    let video: ICameraVideoTrack | null = null;
    (async () => {
      try {
        const ans = await fetch(`/api/calls/${callId}/answer-video`, { method: "POST" });
        if (cancelled) return;
        if (!ans.ok) return onClose();
        const { channelName } = (await ans.json()) as { channelName: string };

        const uid = Math.floor(Math.random() * 1_000_000) + 1_000_001;
        const tokRes = await fetch(
          `/api/agora/token?channel=${encodeURIComponent(channelName)}&uid=${uid}`
        );
        if (cancelled) return;
        if (!tokRes.ok) return onClose();
        const tok = (await tokRes.json()) as {
          appId: string;
          token: string;
          channelName: string;
          uid: number;
        };

        const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
        if (cancelled) return;
        const c = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        client = c;
        clientRef.current = c;
        c.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
          await c.subscribe(user, mediaType);
          if (mediaType === "video" && remoteRef.current)
            (user.videoTrack as IRemoteVideoTrack)?.play(remoteRef.current);
          if (mediaType === "audio") user.audioTrack?.play();
        });
        c.on("user-left", () => void handleEnd());

        await c.join(tok.appId, tok.channelName, tok.token, tok.uid);
        if (cancelled) return; // do NOT publish on an abandoned (e.g. StrictMode) mount
        audio = await AgoraRTC.createMicrophoneAudioTrack();
        video = await AgoraRTC.createCameraVideoTrack();
        if (cancelled) {
          audio.close();
          video.close();
          return;
        }
        audioRef.current = audio;
        videoRef.current = video;
        await c.publish([audio, video]);
        if (cancelled) return;
        if (localRef.current) video.play(localRef.current);
      } catch {
        if (!cancelled) onClose();
      }
    })();
    return () => {
      cancelled = true;
      audio?.close();
      video?.close();
      if (client) client.leave().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  async function handleEnd() {
    try {
      if (roomNumber || notes) {
        await fetch("/api/calls/notes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ callId, roomNumber, notes }),
        }).catch(() => {});
      }
      audioRef.current?.close();
      videoRef.current?.close();
      await clientRef.current?.leave();
    } finally {
      onClose();
    }
  }

  function toggleMute() {
    const n = !muted;
    void audioRef.current?.setMuted(n);
    setMuted(n);
  }
  function toggleCamera() {
    const n = !cameraOff;
    const t = videoRef.current?.getMediaStreamTrack();
    if (t) t.enabled = !n;
    setCameraOff(n);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex flex-1 overflow-hidden">
        {/* 40% guest video (left) */}
        <div className="relative basis-2/5 bg-neutral-900">
          <div ref={remoteRef} className="absolute inset-0" />
          <div
            ref={localRef}
            className="absolute bottom-4 right-4 h-28 w-40 overflow-hidden rounded-md border border-white/40"
          />
        </div>
        <PlaybookPanel callId={callId} />
      </div>

      {/* control bar */}
      <div className="flex items-center gap-2 border-t border-border bg-card p-3">
        <input
          value={roomNumber}
          onChange={(e) => setRoomNumber(e.target.value)}
          placeholder="Room #"
          className="w-24 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes…"
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        <button
          type="button"
          onClick={toggleMute}
          className="flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm"
        >
          {muted ? <MicOff size={16} /> : <Mic size={16} />}
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          type="button"
          onClick={toggleCamera}
          className="flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm"
        >
          {cameraOff ? <VideoOff size={16} /> : <Video size={16} />}
          {cameraOff ? "Cam on" : "Cam off"}
        </button>
        <button
          type="button"
          disabled
          title="Coming soon"
          className="rounded-md border border-border px-3 py-2 text-sm opacity-40"
        >
          Hold
        </button>
        <button
          type="button"
          disabled
          title="Coming soon"
          className="rounded-md border border-border px-3 py-2 text-sm opacity-40"
        >
          Swap
        </button>
        <button
          type="button"
          onClick={() => void handleEnd()}
          className="flex items-center gap-1 rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground"
        >
          <PhoneOff size={16} /> End
        </button>
      </div>

    </div>
  );
}
