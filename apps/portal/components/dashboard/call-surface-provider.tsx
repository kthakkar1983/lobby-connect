"use client";
// Phase-3 call-surface context (spec D1): the Softphone and the video host
// PUBLISH their incoming/active call state here; property cards, the call
// tile, and duty controls CONSUME it. The Twilio Device / video-call machinery
// stays inside its existing owners — this is state mirroring + dispatch,
// never a second call engine.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openCallTile, type CallTileHandle } from "@/lib/duty-tile/call-tile-manager";
import { CallTile } from "@/components/call-tile/call-tile";

export interface IncomingRing {
  key: string; // channel-prefixed for cross-channel uniqueness: "audio:<callId>" | "video:<calls.id>"
  channel: "AUDIO" | "VIDEO";
  callId: string | null;
  propertyId: string | null;
  propertyName: string;
  since: number; // client ms when the ring surfaced
}

export interface ActiveCallInfo {
  callId: string;
  channel: "AUDIO" | "VIDEO";
  propertyId: string | null;
  propertyName: string;
  onHold: boolean;
  answeredAt: number;
  /** Hotel-local timezone (audio: from the answered route) — the tile's clock face. */
  timeZone: string | null;
}

export interface CallSurfaceSnapshot {
  rings: IncomingRing[];
  active: ActiveCallInfo | null;
}

export interface CallSurfaceActions {
  /** Accept the (single) ringing audio call. Registered by Softphone. */
  acceptAudio: (() => void) | null;
  /** Accept a ringing video call by calls.id. Registered by the video host. */
  acceptVideo: ((callId: string) => void) | null;
}

/**
 * Call controls the tile drives (Task 17). Registered by whichever component
 * owns the live call (Softphone for AUDIO, VideoCall for VIDEO) while a call is
 * in progress; cleared (null) on teardown. `triggerEmergency` is OPTIONAL — 911
 * is an audio-only mechanism (there is no video emergency path anywhere in the
 * codebase; see lib/emergency/, app/api/calls/[id]/emergency/*), so the video
 * registration simply omits it and the tile hides its 911 control when absent.
 * Do NOT invent a video 911 path here — this is a UI-composition seam only.
 */
export interface RegisteredCallControls {
  toggleMute: () => void;
  muted: boolean;
  hangUp: () => void;
  triggerEmergency?: () => void;
  saveNote: (room: string, note: string) => Promise<boolean>;
}

interface CallSurfaceValue extends CallSurfaceSnapshot {
  actions: CallSurfaceActions;
  publishRings: (source: "audio" | "video", rings: IncomingRing[]) => void;
  publishActive: (active: ActiveCallInfo | null) => void;
  registerAcceptAudio: (fn: (() => void) | null) => void;
  registerAcceptVideo: (fn: ((callId: string) => void) | null) => void;
  /**
   * Ring keys the LOCAL user has silenced (audio only). The publishers
   * (softphone audio ring / video-host ring) read this and mute their own
   * ringtone element for a silenced key; the card keeps ringing visually and
   * stays answerable. Silence is purely local — it never touches the server
   * call row or other users' rings.
   */
  silencedKeys: ReadonlySet<string>;
  /** Silence the local audio ringer for one ring key (idempotent). */
  silenceRing: (key: string) => void;
  /**
   * Call-scoped Document-PiP tile (spec §3.3). `tileMount` is the element
   * consumers portal into — null while no tile is open. `tileClosedByUser` is
   * true when the agent closed the tile mid-call (drives the Task-17 "Reopen
   * tile" affordance) and resets to false once the call ends or a new tile opens.
   */
  tileMount: HTMLElement | null;
  tileClosedByUser: boolean;
  /** Open the tile. Must be called synchronously inside the Answer click. */
  openTileForCall: () => void;
  /** Close the tile programmatically (e.g. on hang-up). No-op if none is open. */
  closeTile: () => void;
  /**
   * The guest's remote video track (LiveKit), shared so the tile can render its
   * own <video> face without a second subscription. Null when no video call is
   * live, or on an AUDIO call.
   */
  guestVideoTrack: MediaStreamTrack | null;
  publishGuestVideoTrack: (track: MediaStreamTrack | null) => void;
  /** The live call's controls, mirrored so the tile can drive mute/hang-up/911/notes. */
  callControls: RegisteredCallControls | null;
  registerCallControls: (controls: RegisteredCallControls | null) => void;
}

const CallSurfaceContext = createContext<CallSurfaceValue | null>(null);

export function CallSurfaceProvider({ children }: { children: React.ReactNode }) {
  const [audioRings, setAudioRings] = useState<IncomingRing[]>([]);
  const [videoRings, setVideoRings] = useState<IncomingRing[]>([]);
  const [active, setActive] = useState<ActiveCallInfo | null>(null);
  // ── TEMP tile-debug strip (2026-07-07 reopen-affordance diagnosis) ─────────
  // DevTools can't be used on the real machine (opening it interferes with the
  // DocPiP window — observed by Kumar), so the probes render ON-PAGE, Gate-3.0
  // prototype style. Raw colors are deliberate throwaway chrome. REMOVE this
  // whole block (state + tileLog + probe calls + the strip JSX) after diagnosis.
  const [tileDebugLines, setTileDebugLines] = useState<string[]>([]);
  const tileLog = useCallback((line: string) => {
    console.log("[tile-debug]", line);
    setTileDebugLines((prev) => [
      ...prev.slice(-7),
      `${new Date().toLocaleTimeString()} ${line}`,
    ]);
  }, []);
  // TEMP: bridge so the two publisher components (softphone / video host) can
  // write into the strip without a context-type change. Removed with the block.
  useEffect(() => {
    (window as unknown as { __tileLog?: (l: string) => void }).__tileLog = tileLog;
    return () => {
      delete (window as unknown as { __tileLog?: (l: string) => void }).__tileLog;
    };
  }, [tileLog]);
  // ── end TEMP block header (probe call sites + strip JSX below) ─────────────
  // Handlers live in state, not refs: a ref write doesn't trigger a re-render,
  // so the `value` memo below would keep returning a stale `actions` snapshot
  // from before a late Softphone/video-host registration. State makes the
  // dependency real (and keeps react-hooks/exhaustive-deps honest) instead of
  // needing a synthetic version-counter dependency to force a recompute.
  const [acceptAudioFn, setAcceptAudioFn] = useState<(() => void) | null>(null);
  const [acceptVideoFn, setAcceptVideoFn] = useState<((callId: string) => void) | null>(null);
  // Guest video track (LiveKit) — plain state, not a ref: the tile must re-render
  // when the track arrives/clears to (un)mount its <video> face.
  const [guestVideoTrack, setGuestVideoTrack] = useState<MediaStreamTrack | null>(null);
  // Call controls — held in STATE (not a ref) so the tile re-renders when they're
  // registered/cleared. Registration happens in effects on answer/teardown, not
  // per-render, so this doesn't churn.
  const [callControls, setCallControls] = useState<RegisteredCallControls | null>(null);
  // Ring keys the local user has silenced (audio only). Immutable updates keep
  // the Set's identity stable when nothing actually changes, so publisher
  // effects that read it don't churn.
  const [silencedKeys, setSilencedKeys] = useState<ReadonlySet<string>>(() => new Set());

  // Call-scoped Document-PiP tile. The handle (window/close fn) is a REF — it's
  // an imperative object, not render-relevant; only the mount element and the
  // reopen-affordance boolean are state (consumers must re-render on them).
  const [tileMount, setTileMount] = useState<HTMLElement | null>(null);
  const [tileClosedByUser, setTileClosedByUser] = useState(false);
  const tileHandleRef = useRef<CallTileHandle | null>(null);
  // pagehide fires on BOTH user-close and our own programmatic close() — this
  // ref disambiguates so a hang-up-driven close never flips the reopen flag.
  const programmaticCloseRef = useRef(false);
  // Mirrors `active` for the onClosed callback, which must stay []-stable (no
  // `active` in its deps) yet still needs to know if a call is still live.
  const activeRef = useRef<ActiveCallInfo | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const publishRings = useCallback((source: "audio" | "video", rings: IncomingRing[]) => {
    (source === "audio" ? setAudioRings : setVideoRings)(rings);
  }, []);
  const publishActive = useCallback((a: ActiveCallInfo | null) => setActive(a), []);
  const registerAcceptAudio = useCallback((fn: (() => void) | null) => {
    // Functional updates can't hold a plain function value (React would call
    // it as an updater), so wrap it in an updater that returns the function.
    setAcceptAudioFn(() => fn);
  }, []);
  const registerAcceptVideo = useCallback((fn: ((callId: string) => void) | null) => {
    setAcceptVideoFn(() => fn);
  }, []);
  const publishGuestVideoTrack = useCallback((track: MediaStreamTrack | null) => {
    setGuestVideoTrack(track);
  }, []);
  // No functional-update wrap needed here (unlike registerAcceptAudio/Video):
  // RegisteredCallControls is always an object or null, never a bare function,
  // so React can't misinterpret it as a state updater.
  const registerCallControls = useCallback((controls: RegisteredCallControls | null) => {
    setCallControls(controls);
  }, []);

  // Identity-stable dispatcher: silence one ring key. Returns the same Set when
  // the key is already present so a double-silence doesn't churn identity.
  const silenceRing = useCallback((key: string) => {
    setSilencedKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

  // Close the tile programmatically — sets the flag BEFORE calling close() so
  // the pagehide it triggers is recognized as ours, not a user close.
  const closeTile = useCallback(() => {
    const handle = tileHandleRef.current;
    if (!handle) return;
    programmaticCloseRef.current = true;
    handle.close();
  }, []);

  // Open the tile for the active call. Synchronous entry point for the gesture
  // — openCallTile() calls requestWindow() before returning, satisfying the
  // "must run inside the click, before any await" constraint.
  const openTileForCall = useCallback(() => {
    if (tileHandleRef.current) {
      tileLog("openTileForCall: no-op (already open)"); // TEMP tile-debug
      return; // already open — no-op
    }
    tileLog("openTileForCall: requestWindow…"); // TEMP tile-debug
    openCallTile(
      (handle) => {
        tileHandleRef.current = handle;
        setTileMount(handle.mount);
        setTileClosedByUser(false);
        tileLog("onReady — tile open"); // TEMP tile-debug
      },
      () => {
        const wasProgrammatic = programmaticCloseRef.current;
        programmaticCloseRef.current = false;
        tileHandleRef.current = null;
        setTileMount(null);
        // TEMP tile-debug — `programmatic:true` = OUR closeTile (auto-close on
        // active→null); `false` = Chrome/user closed it.
        tileLog(
          `onClosed programmatic:${String(wasProgrammatic)} active:${activeRef.current?.channel ?? "null"}`,
        );
        if (!wasProgrammatic && activeRef.current) {
          setTileClosedByUser(true);
        }
      },
    );
  }, [tileLog]);

  // Auto-reset + no unbounded growth: whenever the set of currently-ringing keys
  // changes, drop any silenced key that is no longer ringing. A brand-new call
  // gets a new key that isn't silenced, so it rings again. ringKeys is memoized
  // so it doesn't get a fresh identity every render (which would loop the effect).
  const ringKeys = useMemo(
    () => new Set([...audioRings, ...videoRings].map((r) => r.key)),
    [audioRings, videoRings],
  );
  useEffect(() => {
    setSilencedKeys((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) {
        if (ringKeys.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : prev; // keep identity stable when nothing pruned
    });
  }, [ringKeys]);

  // Auto-close: when the call ends (active → null), any open tile closes with
  // it and the reopen affordance resets — the call is over, there's nothing
  // left to reopen into. closeTile is []-stable, so this effect only reruns
  // on real `active` transitions, not on every render.
  useEffect(() => {
    tileLog(`active → ${active ? active.channel : "null"}`); // TEMP tile-debug
    if (active === null) {
      closeTile();
      setTileClosedByUser(false);
    }
  }, [active, closeTile, tileLog]);

  // TEMP tile-debug: the value every overlay's "Reopen tile" gate reads.
  useEffect(() => {
    tileLog(`tileClosedByUser → ${String(tileClosedByUser)}`);
  }, [tileClosedByUser, tileLog]);

  const value = useMemo<CallSurfaceValue>(
    () => ({
      rings: [...audioRings, ...videoRings],
      active,
      actions: { acceptAudio: acceptAudioFn, acceptVideo: acceptVideoFn },
      publishRings,
      publishActive,
      registerAcceptAudio,
      registerAcceptVideo,
      silencedKeys,
      silenceRing,
      tileMount,
      tileClosedByUser,
      openTileForCall,
      closeTile,
      guestVideoTrack,
      publishGuestVideoTrack,
      callControls,
      registerCallControls,
    }),
    [
      audioRings,
      videoRings,
      active,
      acceptAudioFn,
      acceptVideoFn,
      publishRings,
      publishActive,
      registerAcceptAudio,
      registerAcceptVideo,
      silencedKeys,
      silenceRing,
      tileMount,
      tileClosedByUser,
      openTileForCall,
      closeTile,
      guestVideoTrack,
      publishGuestVideoTrack,
      callControls,
      registerCallControls,
    ],
  );

  return (
    <CallSurfaceContext.Provider value={value}>
      {children}
      {tileMount ? createPortal(<CallTile />, tileMount) : null}
      {/* TEMP tile-debug strip — on-page probe output (raw colors deliberate,
          throwaway diagnostic chrome). REMOVE with the rest of the TEMP block. */}
      {tileDebugLines.length > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed bottom-2 left-2 z-[9999] max-w-sm rounded-md p-2 font-mono text-[10px] leading-tight"
          style={{ background: "rgba(0,0,0,0.72)", color: "#fff" }}
        >
          <div style={{ opacity: 0.7 }}>tile-debug</div>
          {tileDebugLines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </CallSurfaceContext.Provider>
  );
}

export function useCallSurface(): CallSurfaceValue {
  const ctx = useContext(CallSurfaceContext);
  if (!ctx) throw new Error("useCallSurface must be used inside CallSurfaceProvider");
  return ctx;
}

/** Safe variant for components that may render outside the shell (returns null). */
export function useCallSurfaceOptional(): CallSurfaceValue | null {
  return useContext(CallSurfaceContext);
}
