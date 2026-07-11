"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff, PictureInPicture2, Monitor, CornerDownLeft, Check, Loader2, AlertTriangle } from "lucide-react";
import * as Sentry from "@sentry/nextjs";
import { MAX_CALL_DURATION_MS } from "@lc/shared";
import type { VideoTokenResult } from "@lc/shared";
import { joinLiveKitCall, type LiveKitCallSession, type PortalVideoHandle } from "@/lib/video/livekit-session";
import { recoverAudioOnNextGesture } from "@/lib/video/audio-unlock";
import { PlaybookPanel } from "@/components/call/playbook-panel";
import { CaptionBand } from "@/components/call/caption-band";
import { CaptionToggle } from "@/components/call/caption-toggle";
import { useCaptions } from "@/lib/captions/use-captions";
import { reliableFetch } from "@/lib/http/reliable-fetch";
import { useCallSurfaceOptional } from "@/components/dashboard/call-surface-provider";
import { docPipSupported } from "@/lib/duty-tile/call-tile-manager";

export function VideoCall({
  callId,
  onClose,
  propertyName,
  propertyId,
  collapsed = false,
}: {
  callId: string;
  onClose: () => void;
  propertyName: string;
  /** Phase E (Task 19b): drives the control bar's Connect button. Nullable —
   *  a video ring can carry a null propertyId same as audio's TwiML Parameter. */
  propertyId: string | null;
  /** Spec D2: hide the guest-video stage (playbook fills it) while the tile is up. */
  collapsed?: boolean;
}) {
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [mediaWarning, setMediaWarning] = useState<"camera" | "mic" | "both" | null>(null);
  const [roomNumber, setRoomNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [guestAudioTrack, setGuestAudioTrack] = useState<MediaStreamTrack | null>(null);
  // Set when LiveKit reports the cold first-call autoplay of the guest audio as
  // blocked — surfaces a deterministic "Tap to hear guest" control rather than
  // relying on a stray pointer/keydown the listening agent may never make.
  const [audioBlocked, setAudioBlocked] = useState(false);
  const remoteRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLDivElement>(null);
  const lkSessionRef = useRef<LiveKitCallSession | null>(null);
  const lkLocalVideoRef = useRef<PortalVideoHandle | null>(null);
  // The recovery fn for the audio-blocked banner (livekit: room.startAudio()).
  const audioRecoveryRef = useRef<(() => void) | null>(null);
  const finalizingRef = useRef(false);
  // Ref-mirror roomNumber/notes so the guest-left teardown (which captures
  // handleEnd at mount time) always reads the current values.
  const roomNumberRef = useRef(roomNumber);
  roomNumberRef.current = roomNumber;
  const notesRef = useRef(notes);
  notesRef.current = notes;
  // Explicit in-call notes save (Enter/Tab) with in-field feedback — parity with
  // the audio overlay. The saveFailed banner below remains the teardown backstop.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  // Task 17: mirror the guest video track + register call controls into the
  // CallSurfaceProvider so the call-scoped tile can render its own face and
  // drive mute/hang-up/notes. `useCallSurfaceOptional` keeps this component
  // renderable outside the provider (video-call.test.tsx mounts it standalone).
  // ⚠ DEP-HYGIENE: read the STABLE dispatchers off `surface`, never depend on
  // `surface` itself in an effect (mirrors softphone.tsx / video-call-host.tsx).
  const surface = useCallSurfaceOptional();
  const publishGuestVideoTrack = surface?.publishGuestVideoTrack;
  const registerCallControls = surface?.registerCallControls;
  const tileClosedByUser = surface?.tileClosedByUser ?? false;
  const openTileForCall = surface?.openTileForCall;

  // Captions (spec D6–D8): enabled state now lives in the surface (shared by the
  // overlay + tile toggles, default OFF, reset per call). No provider (standalone
  // render) → OFF + no-op toggle.
  const captionsEnabled = surface?.captionsEnabled ?? false;
  const toggleCaptions = surface?.toggleCaptions ?? (() => {});
  const publishCaptions = surface?.publishCaptions;
  // Gating the track (not just hiding the band) tears down the STT stream when
  // captions are off — stops the upstream audio + the per-minute billing.
  const captions = useCaptions(captionsEnabled ? guestAudioTrack : null);
  // Feed the tile's caption band (spec D8). Local band render is unchanged.
  // DEP-HYGIENE: depend on the STABLE dispatcher + the caption text, never on
  // `surface` itself (mirrors the other publisher effects in this file).
  useEffect(() => {
    publishCaptions?.(captions.finals, captions.partial);
  }, [publishCaptions, captions.finals, captions.partial]);

  // Accept the call, then join LiveKit.
  // NOTE: the cleanup must tear down the session, and we must bail on
  // `cancelled` after each await. React StrictMode (dev) mounts effects twice;
  // without this, the first run still joins + publishes and is then abandoned —
  // leaking a second publisher whose audio is never muted. Local (not ref) vars
  // are used in cleanup because a second mount overwrites the refs.
  useEffect(() => {
    let cancelled = false;
    let capTimer: ReturnType<typeof setTimeout> | undefined;
    let lkSession: LiveKitCallSession | null = null;
    (async () => {
      try {
        const ans = await fetch(`/api/calls/${callId}/answer-video`, { method: "POST" });
        if (cancelled) return;
        if (!ans.ok) return onClose();
        const { channelName } = (await ans.json()) as { channelName: string };

        // Legacy wire param — the token route still validates uid; LiveKit ignores it.
        const uid = Math.floor(Math.random() * 1_000_000) + 1_000_001;
        const tokRes = await fetch(
          `/api/video/token?channel=${encodeURIComponent(channelName)}&uid=${uid}`
        );
        if (cancelled) return;
        if (!tokRes.ok) return onClose();
        const tok = (await tokRes.json()) as VideoTokenResult;

        const session = await joinLiveKitCall({
          url: tok.url,
          token: tok.token,
          onRemoteVideo: (h) => {
            if (!cancelled && remoteRef.current) h.attach(remoteRef.current);
            // Task 17: share the guest's remote track with the tile (its own
            // muted <video> face) — additive; the in-tab attach above is unchanged.
            if (!cancelled) publishGuestVideoTrack?.(h.mediaStreamTrack());
          },
          onRemoteAudioTrack: (t) => {
            if (!cancelled) setGuestAudioTrack(t);
          },
          onAudioBlocked: (recover) => {
            audioRecoveryRef.current = () => {
              recover();
            };
            Sentry.addBreadcrumb({
              category: "livekit",
              level: "warning",
              message: "remote audio autoplay blocked; recovering on next interaction",
            });
            if (!cancelled) setAudioBlocked(true);
            recoverAudioOnNextGesture(() => {
              recover();
              if (!cancelled) setAudioBlocked(false);
            });
          },
          onGuestLeft: () => void handleEnd(),
        });
        if (cancelled) {
          await session.leave();
          return;
        }
        lkSessionRef.current = session;
        lkLocalVideoRef.current = session.localVideo;
        if (!session.localVideo) setCameraOff(true);
        setMediaWarning(session.mediaWarning);
        if (session.localVideo && localRef.current) session.localVideo.attach(localRef.current);
        // Cost/hygiene backstop (spec D10: the app-level cap is the authoritative
        // duration bound on LiveKit). handleEnd is idempotent (finalizingRef), so
        // this is safe alongside End / guest-left.
        capTimer = setTimeout(() => {
          Sentry.captureMessage("agent video call hit max-duration cap; ending", {
            level: "warning",
          });
          void handleEnd();
        }, MAX_CALL_DURATION_MS);
        lkSession = session;
      } catch {
        if (!cancelled) onClose();
      }
    })();
    return () => {
      cancelled = true;
      if (capTimer) clearTimeout(capTimer);
      if (lkSession) void lkSession.leave();
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
    return !!res && res.ok;
  }

  // Explicit in-call save (Enter/Tab). Drives only the in-field indicator — NOT
  // the teardown saveFailed banner (whose Retry ends the call), so a mid-call
  // save failure never offers a call-ending Retry.
  async function handleSave() {
    if (saveState === "saving") return;
    setSaveState("saving");
    const ok = await saveNotes();
    setSaveState(ok ? "saved" : "failed");
    if (ok) {
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaveState("idle"), 1500);
    }
  }
  function onKeyDownSave(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSave();
    } else if (e.key === "Tab") {
      // Tab saves too; no preventDefault so focus still moves normally.
      void handleSave();
    }
  }

  async function handleEnd() {
    // Idempotent: guest-left (guest hung up / crashed) and the End button can both
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
      await lkSessionRef.current?.leave();
      lkSessionRef.current = null;
      setGuestAudioTrack(null);
      // Task 17: clear the tile's mirrored track alongside the in-tab one.
      publishGuestVideoTrack?.(null);
    }
    const ok = await saveNotes();
    if (ok) onClose();
    else setSaveFailed(true);
  }

  function toggleMute() {
    const n = !muted;
    void lkSessionRef.current?.setMicMuted(n);
    setMuted(n);
  }
  function toggleCamera() {
    const n = !cameraOff;
    const t = lkLocalVideoRef.current?.mediaStreamTrack();
    if (t) t.enabled = !n;
    setCameraOff(n);
  }

  // Task 17: register this call's controls with the CallSurfaceProvider so the
  // tile can drive mute/hang-up/notes. handleEnd/saveNotes/toggleMute above are
  // untouched — these are ADDITIVE stable wrappers around them, defined ONCE
  // per render (not memoized: this file doesn't useCallback its handlers) and
  // held in refs so the registration effect below can stay identity-stable.
  //   - hangUp / toggleMute delegate straight to the existing handlers.
  //   - saveNote syncs the in-tab roomNumber/notes state (so tab + tile agree),
  //     then reuses the real saveNotes() — no new save path.
  //   - VIDEO has no 911 mechanism anywhere in the codebase, so triggerEmergency
  //     is simply omitted (it's optional on RegisteredCallControls); the tile
  //     hides its 911 control when absent.
  const hangUpForTile = () => void handleEnd();
  const saveNoteForTile = async (room: string, note: string) => {
    setRoomNumber(room);
    setNotes(note);
    roomNumberRef.current = room;
    notesRef.current = note;
    return saveNotes();
  };
  const registeredHangUpRef = useRef(hangUpForTile);
  registeredHangUpRef.current = hangUpForTile;
  const registeredSaveNoteRef = useRef(saveNoteForTile);
  registeredSaveNoteRef.current = saveNoteForTile;
  useEffect(() => {
    if (!registerCallControls) return;
    registerCallControls({
      toggleMute,
      muted,
      hangUp: () => registeredHangUpRef.current(),
      saveNote: (room, note) => registeredSaveNoteRef.current(room, note),
    });
    return () => registerCallControls(null);
    // Only re-register on a real mute-state change (the tile must reflect it);
    // hangUp/saveNote read through refs above so they always call the CURRENT
    // handleEnd/saveNotes without needing to be dep-array members themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerCallControls, muted]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header strip */}
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-live shadow-[0_0_0_3px_var(--color-live-glow)]" />
          On video · {propertyName}
        </span>
      </div>

      {audioBlocked && (
        <div className="flex items-center justify-between gap-3 border-b border-attention/40 bg-attention/10 px-4 py-2 text-sm text-attention-text">
          <span>You can&apos;t hear the guest yet — your browser paused the audio.</span>
          <button
            type="button"
            onClick={() => {
              audioRecoveryRef.current?.();
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
        <div
          data-testid="guest-video-stage"
          className={`relative basis-2/5 bg-[var(--color-call)]${collapsed ? " hidden" : ""}`}
        >
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
          {/* Task 17 (repositioned 2026-07-09): reopen the call tile if the agent
              closed it mid-call. A small teal pill floating at the bottom-right of
              the guest stage, seated above the caption band — replaces the flat
              grey header pill that read as easy to miss. */}
          {tileClosedByUser && docPipSupported() && (
            <button
              type="button"
              onClick={() => openTileForCall?.()}
              className="absolute bottom-16 right-3 z-10 flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground shadow-md"
            >
              <PictureInPicture2 size={14} /> Reopen tile
            </button>
          )}
        </div>
        <PlaybookPanel callId={callId} basis={collapsed ? "basis-full" : "basis-3/5"} />
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
          onKeyDown={onKeyDownSave}
          placeholder="Room #"
          className="w-24 rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        <div className="relative flex flex-1 items-center">
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onKeyDown={onKeyDownSave}
            placeholder="Notes…"
            className="w-full rounded-input border border-border bg-background py-2 pl-3 pr-9 text-sm text-foreground"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 flex items-center"
          >
            {saveState === "saving" ? (
              <Loader2 size={16} className="animate-spin text-text-muted motion-reduce:animate-none" />
            ) : saveState === "saved" ? (
              <Check size={16} className="text-live-foreground" />
            ) : saveState === "failed" ? (
              <AlertTriangle size={15} className="text-destructive" />
            ) : (
              <CornerDownLeft size={16} className="text-text-muted" />
            )}
          </span>
          <span role="status" aria-live="polite" className="sr-only">
            {saveState === "saving"
              ? "Saving notes"
              : saveState === "saved"
                ? "Notes saved"
                : saveState === "failed"
                  ? "Notes save failed — retries after the call"
                  : ""}
          </span>
        </div>
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
          disabled={!propertyId || !surface}
          onClick={() => {
            if (propertyId) void surface?.connectToProperty(propertyId);
          }}
          className="flex items-center gap-1 rounded-button bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
        >
          <Monitor size={16} /> Connect
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
