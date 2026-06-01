"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff, AlertTriangle } from "lucide-react";
import type { IAgoraRTCClient, IAgoraRTCRemoteUser, ICameraVideoTrack, IMicrophoneAudioTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";
import { PlaybookPanel } from "./playbook-panel";

export function VideoCall({ callId, onClose }: { callId: string; onClose: () => void }) {
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [roomNumber, setRoomNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [emergencyOpen, setEmergencyOpen] = useState(false);

  const remoteRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const audioRef = useRef<IMicrophoneAudioTrack | null>(null);
  const videoRef = useRef<ICameraVideoTrack | null>(null);

  // Accept the call, then join Agora.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ans = await fetch(`/api/calls/${callId}/answer-video`, { method: "POST" });
        if (!ans.ok) return onClose();
        const { channelName } = (await ans.json()) as { channelName: string };

        const uid = Math.floor(Math.random() * 1_000_000) + 1_000_001;
        const tokRes = await fetch(`/api/agora/token?channel=${encodeURIComponent(channelName)}&uid=${uid}`);
        if (!tokRes.ok) return onClose();
        const tok = (await tokRes.json()) as { appId: string; token: string; channelName: string; uid: number };

        const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
        const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        clientRef.current = client;
        client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
          await client.subscribe(user, mediaType);
          if (mediaType === "video" && remoteRef.current) (user.videoTrack as IRemoteVideoTrack)?.play(remoteRef.current);
          if (mediaType === "audio") user.audioTrack?.play();
        });
        client.on("user-left", () => void handleEnd());

        await client.join(tok.appId, tok.channelName, tok.token, tok.uid);
        const audio = await AgoraRTC.createMicrophoneAudioTrack();
        const video = await AgoraRTC.createCameraVideoTrack();
        audioRef.current = audio;
        videoRef.current = video;
        await client.publish([audio, video]);
        if (!cancelled && localRef.current) video.play(localRef.current);
      } catch {
        if (!cancelled) onClose();
      }
    })();
    return () => { cancelled = true; };
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

  function toggleMute() { const n = !muted; const t = audioRef.current?.getMediaStreamTrack(); if (t) t.enabled = !n; setMuted(n); }
  function toggleCamera() { const n = !cameraOff; const t = videoRef.current?.getMediaStreamTrack(); if (t) t.enabled = !n; setCameraOff(n); }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex flex-1 overflow-hidden">
        {/* 40% guest video (left) */}
        <div className="relative basis-2/5 bg-neutral-900">
          <div ref={remoteRef} className="absolute inset-0" />
          <div ref={localRef} className="absolute bottom-4 right-4 h-28 w-40 overflow-hidden rounded-md border border-white/40" />
        </div>
        <PlaybookPanel callId={callId} />
      </div>

      {/* control bar */}
      <div className="flex items-center gap-2 border-t border-border bg-card p-3">
        <input value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} placeholder="Room #"
          className="w-24 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes…"
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
        <button type="button" onClick={toggleMute} className="flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm">
          {muted ? <MicOff size={16} /> : <Mic size={16} />}{muted ? "Unmute" : "Mute"}
        </button>
        <button type="button" onClick={toggleCamera} className="flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm">
          {cameraOff ? <VideoOff size={16} /> : <Video size={16} />}{cameraOff ? "Cam on" : "Cam off"}
        </button>
        <button type="button" disabled title="Coming soon" className="rounded-md border border-border px-3 py-2 text-sm opacity-40">Hold</button>
        <button type="button" disabled title="Coming soon" className="rounded-md border border-border px-3 py-2 text-sm opacity-40">Swap</button>
        <button type="button" onClick={() => setEmergencyOpen(true)} className="flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle size={16} /> Emergency
        </button>
        <button type="button" onClick={() => void handleEnd()} className="flex items-center gap-1 rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground">
          <PhoneOff size={16} /> End
        </button>
      </div>

      {emergencyOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="max-w-md rounded-lg bg-card p-6">
            <h2 className="text-lg font-semibold text-red-700">Emergency response</h2>
            <p className="mt-2 text-sm text-text-muted">Emergency calling arrives in Plan 6c (conference to emergency services, alert the on-call manager, log an incident).</p>
            <button type="button" onClick={() => setEmergencyOpen(false)} className="mt-4 rounded-md border border-border px-3 py-2 text-sm">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
