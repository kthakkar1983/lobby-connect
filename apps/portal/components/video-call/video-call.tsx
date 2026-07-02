"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff } from "lucide-react";
import * as Sentry from "@sentry/nextjs";
import type {
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
  IRemoteAudioTrack,
  IRemoteVideoTrack,
} from "agora-rtc-sdk-ng";
import { MAX_CALL_DURATION_MS } from "@lc/shared";
import { recoverAudioOnNextGesture } from "@/lib/video/audio-unlock";
import { reportGuestAudioDiagnostics } from "@/lib/video/diag-audio";
import { PlaybookPanel } from "@/components/call/playbook-panel";
import { CaptionBand } from "@/components/call/caption-band";
import { CaptionToggle } from "@/components/call/caption-toggle";
import { useCaptions } from "@/lib/captions/use-captions";
import { useCaptionsEnabled } from "@/lib/captions/use-captions-enabled";
import { reliableFetch } from "@/lib/http/reliable-fetch";

export function VideoCall({ callId, onClose, propertyName }: { callId: string; onClose: () => void; propertyName: string }) {
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [mediaWarning, setMediaWarning] = useState<"camera" | "mic" | "both" | null>(null);
  const [roomNumber, setRoomNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [guestAudioTrack, setGuestAudioTrack] = useState<MediaStreamTrack | null>(null);
  // Set when Agora reports the cold first-call autoplay of the guest audio as
  // blocked — surfaces a deterministic "Tap to hear guest" control rather than
  // relying on a stray pointer/keydown the listening agent may never make.
  const [audioBlocked, setAudioBlocked] = useState(false);
  const autoplayFailedRef = useRef(false);
  // TEMP on-screen diagnostic (enable with ?diag=1 on the portal URL). Shows the
  // live energy of the GUEST's received audio so we can tell — with no DevTools
  // and no Sentry — whether the guest audio is reaching the agent at all. Its mere
  // presence also confirms the fresh build is loaded (busts the cache doubt).
  const [diagOn] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("diag"),
  );
  const [diagEnergy, setDiagEnergy] = useState(-1);
  const remoteRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const audioRef = useRef<IMicrophoneAudioTrack | null>(null);
  const videoRef = useRef<ICameraVideoTrack | null>(null);
  // The guest's remote audio track, kept so the silent autoplay-recovery can
  // re-play it on the agent's next interaction if the browser blocked it.
  const remoteAudioRef = useRef<IRemoteAudioTrack | null>(null);
  const finalizingRef = useRef(false);
  // Ref-mirror roomNumber/notes so the Agora "user-left" event listener (which
  // captures handleEnd at mount time) always reads the current values.
  const roomNumberRef = useRef(roomNumber);
  roomNumberRef.current = roomNumber;
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const { enabled: captionsEnabled, toggle: toggleCaptions } = useCaptionsEnabled();
  // Gating the track (not just hiding the band) tears down the STT stream when
  // captions are off — stops the upstream audio + the per-minute billing.
  const captions = useCaptions(captionsEnabled ? guestAudioTrack : null);

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
    let capTimer: ReturnType<typeof setTimeout> | undefined;
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
        // If the browser blocks remote-audio autoplay (common on a cold first
        // call after idle), recover silently on the agent's next interaction —
        // no customer-facing prompt. A breadcrumb confirms cause/recovery in prod.
        AgoraRTC.onAutoplayFailed = () => {
          autoplayFailedRef.current = true;
          Sentry.addBreadcrumb({
            category: "agora",
            level: "warning",
            message: "remote audio autoplay blocked; recovering on next interaction",
          });
          // Deterministic recovery: a visible control the agent can tap. Keep the
          // stray-gesture backstop too — whichever fires first restores audio.
          if (!cancelled) setAudioBlocked(true);
          recoverAudioOnNextGesture(() => {
            void remoteAudioRef.current?.play();
            if (!cancelled) setAudioBlocked(false);
          });
        };
        const c = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        client = c;
        clientRef.current = c;
        c.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
          await c.subscribe(user, mediaType);
          if (mediaType === "video" && remoteRef.current)
            (user.videoTrack as IRemoteVideoTrack)?.play(remoteRef.current);
          if (mediaType === "audio") {
            remoteAudioRef.current = user.audioTrack ?? null;
            user.audioTrack?.play();
            // TEMPORARY DIAGNOSTIC — report whether the guest audio actually
            // produces energy at the agent (output/device issue vs never-arrived).
            reportGuestAudioDiagnostics(
              user.audioTrack,
              () => autoplayFailedRef.current,
              () => cancelled,
            );
            setGuestAudioTrack(user.audioTrack?.getMediaStreamTrack() ?? null);
          }
        });
        c.on("user-left", () => void handleEnd());

        await c.join(tok.appId, tok.channelName, tok.token, tok.uid);
        if (cancelled) return; // do NOT publish on an abandoned (e.g. StrictMode) mount

        // Cost backstop: hard-cap a connected call's duration so an abandoned
        // call (agent leaves the tab open) can't keep the Agora channel — and its
        // per-participant billing — alive to the 1h token expiry. handleEnd is
        // idempotent (finalizingRef), so this is safe alongside End / user-left.
        capTimer = setTimeout(() => {
          Sentry.captureMessage("agent video call hit max-duration cap; ending", {
            level: "warning",
          });
          void handleEnd();
        }, MAX_CALL_DURATION_MS);

        // Acquire mic + camera INDEPENDENTLY and resiliently. A device that's
        // busy (e.g. the webcam held by another app) or permission-denied must
        // NOT abandon the call — otherwise the agent silently drops while the
        // guest keeps ringing and the call lands as missed. Join with whatever
        // media is available (audio-only is fine) so the guest always connects.
        try {
          audio = await AgoraRTC.createMicrophoneAudioTrack();
        } catch {
          audio = null;
        }
        try {
          video = await AgoraRTC.createCameraVideoTrack();
        } catch {
          video = null;
        }
        if (cancelled) {
          audio?.close();
          video?.close();
          return;
        }
        audioRef.current = audio;
        videoRef.current = video;
        if (!video) setCameraOff(true);
        setMediaWarning(!audio && !video ? "both" : !audio ? "mic" : !video ? "camera" : null);
        const tracks = [audio, video].filter(
          (t): t is IMicrophoneAudioTrack | ICameraVideoTrack => t != null,
        );
        if (tracks.length > 0) await c.publish(tracks);
        if (cancelled) return;
        if (video && localRef.current) video.play(localRef.current);
      } catch {
        if (!cancelled) onClose();
      }
    })();
    return () => {
      cancelled = true;
      if (capTimer) clearTimeout(capTimer);
      audio?.close();
      video?.close();
      if (client) client.leave().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  // TEMP: poll the guest audio energy for the on-screen ?diag meter.
  useEffect(() => {
    if (!diagOn) return;
    const id = setInterval(() => {
      const lvl = remoteAudioRef.current?.getVolumeLevel?.();
      setDiagEnergy(typeof lvl === "number" ? lvl : -1);
    }, 300);
    return () => clearInterval(id);
  }, [diagOn]);

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
      setGuestAudioTrack(null);
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

      {diagOn && (
        <div className="border-b border-attention/60 bg-attention/15 px-4 py-2 text-center font-mono text-sm font-semibold text-attention-text">
          DIAG · guest audio level:{" "}
          {diagEnergy < 0 ? "— (no guest track yet)" : diagEnergy.toFixed(3)}
          {diagEnergy >= 0 ? (diagEnergy > 0 ? "  ✓ ARRIVING" : "  ✗ SILENT") : ""}
          {audioBlocked ? "  · ⚠ AUTOPLAY BLOCKED" : ""}
        </div>
      )}

      {audioBlocked && (
        <div className="flex items-center justify-between gap-3 border-b border-attention/40 bg-attention/10 px-4 py-2 text-sm text-attention-text">
          <span>You can&apos;t hear the guest yet — your browser paused the audio.</span>
          <button
            type="button"
            onClick={() => {
              void remoteAudioRef.current?.play();
              setAudioBlocked(false);
            }}
            className="shrink-0 rounded-button bg-live px-3 py-1.5 font-medium text-primary"
          >
            Tap to hear guest
          </button>
        </div>
      )}

      {mediaWarning && (
        <div className="border-b border-attention/40 bg-attention/10 px-4 py-1.5 text-xs text-attention-text">
          {mediaWarning === "camera"
            ? "Your camera is unavailable (in use by another app?). You're connected audio-only — turn the camera on once it's free."
            : mediaWarning === "mic"
              ? "Your microphone is unavailable. The guest may not hear you — close other apps using it or check permissions."
              : "Your camera and microphone are unavailable. Close other apps using them or check browser permissions."}
        </div>
      )}

      {/* SHARED-CHROME SEAM: the audio in-call overlay (components/softphone/audio-call-overlay.tsx)
          mirrors this chrome (header strip + --color-call stage + control bar + PlaybookPanel). If the
          two drift, extract a shared <CallShell> consumed by both. */}
      <div className="flex flex-1 overflow-hidden">
        {/* 40% guest video (left) — deep-navy video stage */}
        <div className="relative basis-2/5 bg-[var(--color-call)]">
          <div ref={remoteRef} className="absolute inset-0" />
          {/* Self-view sits top-right (matches the kiosk) so the bottom-anchored
              caption band below never covers it. */}
          <div
            ref={localRef}
            className="absolute right-4 top-4 h-28 w-40 overflow-hidden rounded-md border-2 [border-image:var(--gradient-seam)_1]"
          />
          <CaptionBand
            finals={captions.finals}
            partial={captions.partial}
            className="absolute inset-x-3 bottom-3"
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
        <CaptionToggle enabled={captionsEnabled} onToggle={toggleCaptions} />
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
          className="flex items-center gap-1.5 rounded-button bg-primary px-3 py-2 text-[1.1875rem] font-bold leading-none text-primary-foreground"
        >
          <PhoneOff size={18} /> End
        </button>
      </div>

    </div>
  );
}
