"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, MicOff, Video, VideoOff, PictureInPicture2, Monitor, CornerDownLeft, Check, Loader2, AlertTriangle } from "lucide-react";
import * as Sentry from "@sentry/nextjs";
import {
  MAX_CALL_DURATION_MS,
  OUTBOUND_RING_WINDOW_MS,
  CHAT_PROTOCOL_VERSION,
  decodeChat,
  encodeChat,
  newMessageId,
  redactCardNumbers,
  typingExpired,
} from "@lc/shared";
import type { VideoTokenResult } from "@lc/shared";
import { joinLiveKitCall, type LiveKitCallSession, type PortalVideoHandle } from "@/lib/video/livekit-session";
import { recoverAudioOnNextGesture } from "@/lib/video/audio-unlock";
import { PlaybookPanel } from "@/components/call/playbook-panel";
import { CaptionBand } from "@/components/call/caption-band";
import { CaptionToggle } from "@/components/call/caption-toggle";
import { ChatDock } from "@/components/call/chat-dock";
import { CallShell } from "@/components/call/call-shell";
import {
  CallControlDivider,
  CallToggleButton,
  EndCallButton,
} from "@/components/call/call-controls";
import { PropertyActionButton } from "@/components/dashboard/property-action-button";
import { useCaptions } from "@/lib/captions/use-captions";
import { reliableFetch } from "@/lib/http/reliable-fetch";
import { connectErrorMessage } from "@/lib/remote-access/connect-error";
import { useCallSurfaceOptional } from "@/components/dashboard/call-surface-provider";
import { docPipSupported } from "@/lib/duty-tile/call-tile-manager";

// Stable module-level fallbacks so useSyncExternalStore is called
// unconditionally (never behind an optional-chain) — mirrors call-tile.tsx's
// NOOP_SUBSCRIBE/GET_EMPTY_CHAT pattern for the same chat relay.
const NOOP_CHAT_SUBSCRIBE = () => () => {};
const EMPTY_CHAT_SNAPSHOT = { lines: [] as { id: string; from: "guest" | "agent"; text: string; ts: number }[], peerTyping: false };
const GET_EMPTY_CHAT_SNAPSHOT = () => EMPTY_CHAT_SNAPSHOT;

export function VideoCall({
  callId,
  onClose,
  propertyName,
  propertyId,
  collapsed = false,
  outbound = false,
  channelName = null,
}: {
  callId: string;
  onClose: () => void;
  propertyName: string;
  /** Phase E (Task 19b): drives the control bar's Connect button. Nullable —
   *  a video ring can carry a null propertyId same as audio's TwiML Parameter. */
  propertyId: string | null;
  /** Spec D2: hide the guest-video stage (playbook fills it) while the tile is up. */
  collapsed?: boolean;
  /**
   * Task 13: true for an agent-originated (OUTBOUND) call — the row already
   * exists as RINGING with its channel name in hand (start-outbound-video), so
   * the component skips the inbound answer-video claim POST below and instead
   * joins LiveKit directly on `channelName`, showing a "Calling…" pre-connect
   * phase until the kiosk answers. False/absent for an inbound ring answered
   * from a property card — behavior unchanged. Set by video-call-host.tsx (via
   * startOutboundVideo/registerStartOutbound).
   */
  outbound?: boolean;
  /**
   * Task 13: the LiveKit channel for an OUTBOUND call, already known before
   * any answer event (the backend generates it in start-outbound-video) — read
   * directly when `outbound` is true. Null for inbound calls, which fetch
   * their own channelName via the answer-video claim POST instead.
   */
  channelName?: string | null;
}) {
  // Task 13: an outbound call starts in the pre-connect "Calling…" phase
  // (waiting for the kiosk to answer); inbound is implicitly connected the
  // moment the claim POST below succeeds, so it starts (and stays) "connected".
  const [phase, setPhase] = useState<"calling" | "connected">(outbound ? "calling" : "connected");
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
  // Chat typing watchdog: typing pings are lossy (unreliable DC), so a dropped
  // "stop" would leave the guest's dots stuck on. lastPeerTypingRef holds the ms
  // of the last "start"; the interval clears peerTyping once it goes stale.
  const lastPeerTypingRef = useRef(0);
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
  // Hoisted because TWO things key off it: the corner control itself, and the
  // caption band, which gives the corner up while it is there (spec §6).
  const showReopenTile = tileClosedByUser && docPipSupported();

  // Task 14 / spec §7 — the behavioural gap. This Connect called
  // connectToProperty as a bare `void` with no catch, so a failed remote-access
  // launch was SILENT: mid guest-call the agent pressed Connect, RustDesk never
  // opened, and nothing said whether it was still coming or would never come.
  const connectToProperty = surface?.connectToProperty;
  const [connectError, setConnectError] = useState<string | null>(null);
  // Both reasons are REAL unavailability, not duty, so neither may reach the
  // duty guard: a video ring can carry a null propertyId (same as audio's TwiML
  // Parameter), and outside a CallSurfaceProvider there is nothing to connect
  // WITH. Offering "start your shift" for either would be a lie — starting a
  // shift gives this call neither a property nor a provider.
  const connectUnavailable = !propertyId
    ? "This call has no property to connect to"
    : !connectToProperty
      ? "Remote access is unavailable here"
      : null;

  async function handleConnect() {
    if (!propertyId || !connectToProperty) return;
    try {
      // Called synchronously inside the click, before any await, so a pre-warmed
      // cache hit still launches on the click's transient activation.
      setConnectError(connectErrorMessage(await connectToProperty(propertyId)));
    } catch {
      // A throw would skip setConnectError and surface as an unhandled
      // rejection — the exact silence this handler exists to end.
      setConnectError(connectErrorMessage({ launched: false }));
    }
  }

  // Captions (spec D6–D8): enabled state now lives in the surface (shared by the
  // overlay + tile toggles, default OFF, reset per call). No provider (standalone
  // render) → OFF + no-op toggle.
  const captionsEnabled = surface?.captionsEnabled ?? false;
  const toggleCaptions = surface?.toggleCaptions ?? (() => {});
  const publishCaptions = surface?.publishCaptions;
  const appendChatLine = surface?.appendChatLine;
  const setPeerTyping = surface?.setPeerTyping;

  // Task 10: Playbook⇄Chat tab in the right panel — only when NOT collapsed
  // (collapsed = the tile owns chat; the overlay stays playbook-only). The chat
  // relay itself mirrors the tile's useSyncExternalStore subscription (Task 9).
  const chat = useSyncExternalStore(
    surface?.subscribeChat ?? NOOP_CHAT_SUBSCRIBE,
    surface?.getChatSnapshot ?? GET_EMPTY_CHAT_SNAPSHOT,
  );
  const [rightTab, setRightTab] = useState<"playbook" | "chat">("playbook");
  const [chatUnread, setChatUnread] = useState(false);
  const lastSeenChatRef = useRef<string | null | undefined>(undefined); // undefined = not yet seeded

  // Unread-badge detection only — NO chime here (the tile owns the inbound
  // chime; the overlay only badges the tab so it never double-plays a sound).
  useEffect(() => {
    const last = chat.lines[chat.lines.length - 1];
    const lastId = last?.id ?? null;
    if (lastSeenChatRef.current === undefined) {
      lastSeenChatRef.current = lastId; // seed: existing lines aren't "new"
      return;
    }
    if (lastId === lastSeenChatRef.current) return;
    lastSeenChatRef.current = lastId;
    if (last && last.from === "guest" && rightTab !== "chat") setChatUnread(true);
  }, [chat.lines, rightTab]);
  useEffect(() => {
    if (rightTab === "chat") setChatUnread(false);
  }, [rightTab]);

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
        let channel: string | null;
        if (outbound) {
          // Agent-originated: start-outbound-video already created the RINGING
          // row and minted the channel, so there is no kiosk-answers-agent claim
          // to make here (unlike the inbound branch below) — use the prop and
          // wait for the kiosk to join.
          channel = channelName;
        } else {
          const ans = await fetch(`/api/calls/${callId}/answer-video`, { method: "POST" });
          if (cancelled) return;
          if (!ans.ok) {
            // A rejection here (duty-gate 403, claim race 409, etc.) used to close
            // silently — which is exactly what made the stale-heartbeat 403 bug
            // invisible. The root cause is fixed (duty is raw-status now), but a
            // future regression must never be silent: capture it before closing.
            Sentry.captureMessage("video answer rejected", {
              level: "warning",
              extra: { callId, status: ans.status },
            });
            return onClose();
          }
          const claimed = (await ans.json()) as { channelName: string };
          channel = claimed.channelName;
        }
        if (!channel) {
          // Shouldn't happen — the host always supplies channelName for an
          // outbound call (start-outbound-video mints it before this mounts).
          // Fail closed rather than join LiveKit with no channel.
          Sentry.captureMessage("video call missing channelName at join", {
            level: "error",
            extra: { callId, outbound },
          });
          return onClose();
        }

        // Legacy wire param — the token route still validates uid; LiveKit ignores it.
        const uid = Math.floor(Math.random() * 1_000_000) + 1_000_001;
        const tokRes = await fetch(
          `/api/video/token?channel=${encodeURIComponent(channel)}&uid=${uid}`
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
            // Task 13: the kiosk's remote video is the outbound "answered"
            // signal — clears the "Calling…" phase. No-op for inbound (already
            // "connected" from mount).
            if (!cancelled) setPhase("connected");
          },
          onRemoteAudioTrack: (t) => {
            if (!cancelled) setGuestAudioTrack(t);
            if (!cancelled) setPhase("connected");
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
          onData: (payload, fromIdentity) => {
            if (cancelled) return;
            const env = decodeChat(payload);
            if (!env) return;
            if (env.type === "msg") {
              appendChatLine?.({
                id: env.id,
                from: fromIdentity === "kiosk" ? "guest" : "agent",
                text: env.text,
                ts: env.ts,
              });
              // an inbound message means the peer stopped typing
              lastPeerTypingRef.current = 0;
              setPeerTyping?.(false);
            } else if (env.type === "typing") {
              const active = env.state === "start";
              lastPeerTypingRef.current = active ? Date.now() : 0;
              setPeerTyping?.(active);
            }
          },
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

  // Task 13: outbound ring window. The agent originated this call and is
  // waiting for the kiosk to answer; if nobody picks up within
  // OUTBOUND_RING_WINDOW_MS, end it the same way Cancel does — handleEnd POSTs
  // end-video, which finalizes a still-RINGING row to NO_ANSWER (Task 8's
  // generalized end-video handles this; no separate route needed). No-op for
  // inbound (phase is never "calling"). Flipping to "connected" runs this
  // effect's cleanup, canceling the pending timer.
  useEffect(() => {
    if (!outbound || phase !== "calling") return;
    const id = setTimeout(() => {
      void handleEnd();
    }, OUTBOUND_RING_WINDOW_MS);
    return () => clearTimeout(id);
    // handleEnd is a stable function-declaration reference, guarded internally
    // by finalizingRef (idempotent) — intentionally excluded so this effect
    // only re-arms on a real outbound/phase change, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outbound, phase]);

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
  // tile can drive mute/hang-up. handleEnd/toggleMute above are untouched — this
  // is an ADDITIVE stable wrapper around handleEnd, defined ONCE per render (not
  // memoized: this file doesn't useCallback its handlers) and held in a ref so
  // the registration effect below can stay identity-stable.
  //   - hangUp / toggleMute delegate straight to the existing handlers.
  //   - VIDEO has no 911 mechanism anywhere in the codebase, so triggerEmergency
  //     is simply omitted (it's optional on RegisteredCallControls); the tile
  //     hides its 911 control when absent.
  const hangUpForTile = () => void handleEnd();
  const registeredHangUpRef = useRef(hangUpForTile);
  registeredHangUpRef.current = hangUpForTile;
  useEffect(() => {
    if (!registerCallControls) return;
    registerCallControls({
      toggleMute,
      muted,
      // Item 4 (2026-07-21): the tile drives the agent's camera too. Registered
      // here (VIDEO only — audio never mounts VideoCall) so the tile can show a
      // Camera control that mirrors this overlay's. `cameraOff` is in the dep
      // array below, so a toggle re-registers and the tile's mirror stays live.
      toggleCamera,
      cameraOff,
      hangUp: () => registeredHangUpRef.current(),
      sendChat: (text: string) => {
        const clean = redactCardNumbers(text);
        const env = { v: CHAT_PROTOCOL_VERSION, type: "msg" as const, id: newMessageId(), text: clean, ts: Date.now() };
        lkSessionRef.current?.sendData(encodeChat(env), true);
        appendChatLine?.({ id: env.id, from: "agent", text: clean, ts: env.ts }); // local echo
      },
      sendTyping: (state: "start" | "stop") =>
        lkSessionRef.current?.sendData(
          encodeChat({ v: CHAT_PROTOCOL_VERSION, type: "typing", state, ts: Date.now() }),
          false,
        ),
    });
    return () => registerCallControls(null);
    // Re-register on a real mute- OR camera-state change (the tile mirror must
    // reflect both); hangUp reads through the ref above so it always calls the
    // CURRENT handleEnd without needing to be a dep-array member itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerCallControls, muted, cameraOff]);

  useEffect(() => {
    const id = setInterval(() => {
      if (lastPeerTypingRef.current && typingExpired(lastPeerTypingRef.current, Date.now())) {
        lastPeerTypingRef.current = 0;
        setPeerTyping?.(false);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [setPeerTyping]);

  return (
    <CallShell
      title={phase === "calling" ? `Calling · ${propertyName}` : `On video · ${propertyName}`}
      /* No `emergency` — VIDEO has no 911 machinery anywhere in the codebase
         (see the tile-control registration above, which omits triggerEmergency
         for the same reason). Deliberate, per spec §4. */
      bannersAboveBody={
        <>
          {audioBlocked && (
            <div className="flex items-center justify-between gap-3 border-b border-attention/40 bg-attention/10 px-4 py-2 text-sm text-attention-text">
              <span>You can&apos;t hear the guest yet. Your browser paused the audio.</span>
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
                ? "Your camera is unavailable (in use by another app?). You're connected audio-only. Turn the camera on once it's free."
                : mediaWarning === "mic"
                  ? "Your microphone is unavailable. The guest may not hear you. Close other apps using it, or check permissions."
                  : "Your camera and microphone are unavailable. Close other apps using them or check browser permissions."}
            </div>
          )}
        </>
      }
      playbookBasis="60%"
      /* 40% guest video (left) — deep-navy video stage */
      stage={(basis) => (
        <div
          data-testid="guest-video-stage"
          className={`relative ${basis} bg-[var(--color-call)]${collapsed ? " hidden" : ""}`}
        >
          <div ref={remoteRef} className="absolute inset-0" />
          {/* Self-view sits top-right (matches the kiosk) so the bottom-anchored
              caption band below never covers it. */}
          <div
            ref={localRef}
            className="absolute right-4 top-4 h-28 w-40 overflow-hidden rounded-md border-2 [border-image:var(--gradient-seam)_1]"
          />
          {/* left/right rather than `inset-x-3` so ONLY the right edge moves:
              the band yields the corner to the reopen control instead of the
              control floating on top of it (spec §6). Covering the band would
              hide the tail of the guest's sentence — the newest words, which are
              the ones the caption is there for. */}
          <CaptionBand
            finals={captions.finals}
            partial={captions.partial}
            className={`absolute bottom-3 left-3 ${showReopenTile ? "right-16" : "right-3"}`}
          />
          {/* Reopen the call tile if the agent closed it mid-call. Icon-only and
              round, in the TRUE bottom-right corner (spec §6). It was a teal
              filled pill at bottom-16 — chrome sitting mid-frame over a guest
              who fills the shot, and a second teal fill competing with Connect.
              A 40px circle in the corner is a far smaller footprint over a live
              person. (40px = `h-10`, the nearest step on the spacing scale to
              the spec's "~38px" — the spec figure is approximate, not a target.)

              MINT OUTLINE ON A SCRIM — the app's FIRST outline-only mint
              treatment, called out in the spec so it reads as a choice. Mint is
              the live/connect role in the brand, so it says "available action"
              without adding another filled button.

              CONTRAST (WCAG 1.4.11, 3:1 — this is a real control, and its
              boundary is what identifies it). Read the figures below for what
              they are: the ring has an INNER boundary against its own scrim and
              an OUTER one against whatever the guest's camera happens to be
              showing. Only the inner one can be measured, and the outer one
              cannot be guaranteed by construction — a blown-out white or
              mint-adjacent frame puts it well under 3:1. Holding the scrim
              opaque enough that the ring is identified against IT is the
              defensible reading of the SC here, not a claim that every edge of
              this control clears 3:1 against arbitrary video.

              So: the scrim is held at 90%, and the numbers are mint #06D6A0
              (L 0.5067) on the scrim — 8.72:1 over pure navy, 6.47:1 in the
              worst case (a blown-out white frame under the 10% that shows
              through). At the /60 this was first written with, that worst case
              is 2.33:1 — an outright fail — which is why the alpha is where it
              is, and why a test now pins it. Hover DEEPENS the scrim rather
              than lightening it, for the same reason: a mint-tinted hover fill
              would put the ring back over raw video. */}
          {showReopenTile && (
            <button
              type="button"
              onClick={() => openTileForCall?.()}
              /* Icon-only, so the name has to come from aria-label; `title` is
                 additionally how a new agent learns the glyph. */
              title="Reopen tile"
              aria-label="Reopen tile"
              className="absolute bottom-3 right-3 z-10 grid h-10 w-10 place-items-center rounded-full border border-live bg-call/90 text-live shadow-md transition-colors hover:bg-call focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-live focus-visible:ring-offset-2 focus-visible:ring-offset-call"
            >
              <PictureInPicture2 size={17} aria-hidden="true" />
            </button>
          )}
          {/* Task 13: outbound pre-connect phase. An opaque overlay (not a
              replacement of the stage above) so remoteRef/localRef stay mounted
              the whole time — onRemoteVideo's attach() needs remoteRef.current to
              already exist the instant the kiosk joins, which is the same event
              that clears this phase. */}
          {phase === "calling" && (
            <div
              data-testid="outbound-calling-overlay"
              className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-[var(--color-call)] px-6 text-center text-white"
            >
              <Loader2 size={40} className="animate-spin motion-reduce:animate-none" />
              <p className="text-lg font-medium">Calling {propertyName}…</p>
              <button
                type="button"
                onClick={() => void handleEnd()}
                className="rounded-button border border-white/30 px-4 py-2 text-sm font-medium text-white"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
      panel={(basis) =>
        collapsed ? (
          <PlaybookPanel callId={callId} basis="basis-full" />
        ) : (
          <div
            data-testid="video-right-panel"
            className={`flex ${basis} flex-col overflow-hidden border-l border-border`}
          >
            <div className="flex shrink-0 border-b border-border bg-card text-sm">
              <button
                type="button"
                onClick={() => setRightTab("playbook")}
                className={`px-4 py-2 font-medium ${rightTab === "playbook" ? "border-b-2 border-accent text-foreground" : "text-text-muted"}`}
              >
                Playbook
              </button>
              <button
                type="button"
                onClick={() => setRightTab("chat")}
                className={`relative px-4 py-2 font-medium ${rightTab === "chat" ? "border-b-2 border-accent text-foreground" : "text-text-muted"}`}
              >
                Chat
                {chatUnread && (
                  <span data-testid="overlay-chat-unread" className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-attention" />
                )}
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              {rightTab === "playbook" ? (
                <PlaybookPanel callId={callId} basis="basis-full" />
              ) : (
                <ChatDock
                  lines={chat.lines}
                  peerTyping={chat.peerTyping}
                  onSend={(t) => surface?.callControls?.sendChat?.(t)}
                  onTyping={(s) => surface?.callControls?.sendTyping?.(s)}
                  className="min-h-0 flex-1"
                />
              )}
            </div>
          </div>
        )
      }
      bannersBelowBody={
        saveFailed && (
          <div className="flex items-center justify-between gap-3 border-t border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            <span>Couldn&apos;t save notes. They&apos;re still here. Retry or discard.</span>
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
        )
      }
      /* Control bar — Room#/Notes (left, Enter-to-save) · Connect · Mute ·
         Camera · Captions · divider · End call. Connect leads the cluster and
         End call is the far-right bookend, same order as the audio overlay
         (spec §3.1). The input group is capped in REM so it tracks the 112.5%
         root font at `lg`. */
      controls={
        <>
          <div className="flex min-w-0 max-w-[35rem] flex-1 items-center gap-2">
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
                      ? "Notes save failed. Retries after the call."
                      : ""}
              </span>
            </div>
          </div>
          {/* Hold and Swap are gone (spec §5.1 / D10). Both were hardcoded
              `disabled` with title="Coming soon", and Hold was deferred
              entirely to multi-property when the Phase-3 plan was gated — they
              held prime control-bar space doing nothing, and removing them is
              what pays for `End call`'s longer label. */}
          {/* Connect (Task 14, spec §7) — one of five sites now sharing
              <PropertyActionButton>. `tone="teal"` is NOT decoration and NOT
              the default: the 2026-07-10 batch-1 polish split the fill navy on
              the property cards / teal on all three in-call Connects, and this
              component defaults to navy, so omitting it silently reverts that.
              `surface` stays light — this bar is `bg-card`, unlike the tile's
              navy one.

              `gate="none"`: duty can be revoked mid-call from a second tab
              (end-shift has no ON_CALL guard), and remoting into the hotel PC
              during a live call is not an off-duty action. See the header note
              in property-action-button.tsx.

              `errorPlacement="float"`: this bar's geometry is fixed on purpose
              so it cannot move under her hand mid-call; a flow error would grow
              it by ~20px and lift End call and Mute the moment one appeared.

              Task 4 (spec §3.1) moves Connect to LEAD this cluster, right
              after the input group, instead of trailing just before End call —
              mirrors audio's Task 3. Its props below are unchanged by the
              move. */}
          <PropertyActionButton
            label="Connect"
            icon={<Monitor aria-hidden="true" />}
            tone="teal"
            gate="none"
            onAction={handleConnect}
            unavailableReason={connectUnavailable}
            error={connectError}
            errorPlacement="float"
            className="font-semibold"
          />
          {/* Mute, Camera and Captions are flat siblings now, not wrapped in
              <CallControlTray> (spec §3.1) — the tray and its `ml-auto` are
              gone with it; the input group's own `flex-1` above already
              right-packs this whole cluster, so nothing here needs to replace
              it. */}
          <CallToggleButton
            label="Mute"
            icon={muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
            pressed={muted}
            title={muted ? "Turn your microphone on" : "Turn your microphone off"}
            onToggle={toggleMute}
          />
          <CallToggleButton
            label="Camera"
            icon={cameraOff ? <VideoOff aria-hidden="true" /> : <Video aria-hidden="true" />}
            pressed={cameraOff}
            title={cameraOff ? "Turn your camera on" : "Turn your camera off"}
            /* Without this the screen reader announces "Camera, pressed" at
               exactly the moment the camera is OFF — see <CallToggleButton>.
               On the surface whose whole point is kiosk eye contact. */
            stateLabel={cameraOff ? "camera is off" : "camera is on"}
            onToggle={toggleCamera}
          />
          <CaptionToggle
            enabled={captionsEnabled}
            onToggle={toggleCaptions}
            /* Fixed box so the label swap ("Captions" / "Captions off") can't
               widen the bar and shift End call sideways. `shrink-0` because
               this one is a hand-rolled <button>: every <Button>-based sibling
               gets it from the button base, so without it this is the ONE item
               a narrow viewport can squeeze below w-36 and wrap — the exact
               reflow the box exists to prevent. */
            className="h-8 w-36 shrink-0 justify-center py-0"
          />
          <CallControlDivider />
          <EndCallButton tone="blaze" onEnd={() => void handleEnd()} />
        </>
      }
    />
  );
}
