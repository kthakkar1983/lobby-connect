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
import { PlaybookPanel } from "@/components/call/playbook-panel";
import { reliableFetch } from "@/lib/http/reliable-fetch";

export function VideoCall({ callId, onClose, propertyName }: { callId: string; onClose: () => void; propertyName: string }) {
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [roomNumber, setRoomNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const remoteRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const audioRef = useRef<IMicrophoneAudioTrack | null>(null);
  const videoRef = useRef<ICameraVideoTrack | null>(null);
  const finalizingRef = useRef(false);
  // Ref-mirror roomNumber/notes so the Agora "user-left" event listener (which
  // captures handleEnd at mount time) always reads the current values.
  const roomNumberRef = useRef(roomNumber);
  roomNumberRef.current = roomNumber;
  const notesRef = useRef(notes);
  notesRef.current = notes;

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

  async function saveNotes(): Promise<boolean> {
    if (!roomNumberRef.current && !notesRef.current) return true; // nothing to save
    setSaving(true);
    const res = await reliableFetch(
      "/api/calls/notes",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          callId,
          roomNumber: roomNumberRef.current,
          notes: notesRef.current,
        }),
      },
      { label: "calls.notes" },
    );
    setSaving(false);
    const ok = !!res && res.ok;
    setSaveFailed(!ok);
    return ok;
  }

  async function handleEnd() {
    // Idempotent: user-left (guest hung up / crashed) and the End button can both
    // reach here. Tear down video + finalize the row exactly once; the call is over
    // regardless. Then persist notes — and if that fails, keep the overlay mounted
    // (in a "call ended — notes unsaved" state) so the typed text isn't lost.
    if (!finalizingRef.current) {
      finalizingRef.current = true;
      await reliableFetch(
        `/api/calls/${callId}/end-video`,
        { method: "POST" },
        { label: "calls.end_video" },
      );
      audioRef.current?.close();
      videoRef.current?.close();
      await clientRef.current?.leave().catch(() => {});
    }
    const ok = await saveNotes();
    if (ok) onClose();
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
      {/* Header strip */}
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-live shadow-[0_0_0_3px_var(--color-live-glow)]" />
          On video · {propertyName}
        </span>
      </div>

      {/* SHARED-CHROME SEAM: the audio in-call overlay (components/softphone/audio-call-overlay.tsx)
          mirrors this chrome (header strip + --color-call stage + control bar + PlaybookPanel). If the
          two drift, extract a shared <CallShell> consumed by both. */}
      <div className="flex flex-1 overflow-hidden">
        {/* 40% guest video (left) — deep-navy video stage */}
        <div className="relative basis-2/5 bg-[var(--color-call)]">
          <div ref={remoteRef} className="absolute inset-0" />
          <div
            ref={localRef}
            className="absolute bottom-4 right-4 h-28 w-40 overflow-hidden rounded-md border-2 [border-image:var(--gradient-seam)_1]"
          />
        </div>
        <PlaybookPanel callId={callId} />
      </div>

      {saveFailed && (
        <div className="flex items-center justify-between gap-3 border-t border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <span>Couldn&apos;t save notes. They&apos;re still here — retry or discard.</span>
          <span className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleEnd()}
              className="rounded-button bg-destructive px-3 py-1 font-medium text-destructive-foreground disabled:opacity-50"
            >
              {saving ? "Saving…" : "Retry"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded-button border border-border px-3 py-1 disabled:opacity-50"
            >
              Discard
            </button>
          </span>
        </div>
      )}

      {/* control bar */}
      <div className="flex items-center gap-2 border-t border-border bg-card p-3">
        <input
          value={roomNumber}
          onChange={(e) => setRoomNumber(e.target.value)}
          placeholder="Room #"
          className="w-24 rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes…"
          className="flex-1 rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        <button
          type="button"
          onClick={toggleMute}
          className="flex items-center gap-1 rounded-button border border-border px-3 py-2 text-sm"
        >
          {muted ? <MicOff size={16} /> : <Mic size={16} />}
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          type="button"
          onClick={toggleCamera}
          className="flex items-center gap-1 rounded-button border border-border px-3 py-2 text-sm"
        >
          {cameraOff ? <VideoOff size={16} /> : <Video size={16} />}
          {cameraOff ? "Cam on" : "Cam off"}
        </button>
        <button
          type="button"
          disabled
          title="Coming soon"
          className="rounded-button border border-border px-3 py-2 text-sm text-muted-foreground opacity-50"
        >
          Hold
        </button>
        <button
          type="button"
          disabled
          title="Coming soon"
          className="rounded-button border border-border px-3 py-2 text-sm text-muted-foreground opacity-50"
        >
          Swap
        </button>
        <button
          type="button"
          onClick={() => void handleEnd()}
          className="flex items-center gap-1.5 rounded-button bg-accent-strong px-3 py-2 text-[1.1875rem] font-bold leading-none text-accent-foreground"
        >
          <PhoneOff size={18} /> End
        </button>
      </div>

    </div>
  );
}
