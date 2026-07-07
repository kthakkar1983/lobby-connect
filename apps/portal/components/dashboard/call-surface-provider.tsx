"use client";
// Phase-3 call-surface context (spec D1): the Softphone and the video host
// PUBLISH their incoming/active call state here; property cards, the call
// tile, and duty controls CONSUME it. The Twilio Device / video-call machinery
// stays inside its existing owners — this is state mirroring + dispatch,
// never a second call engine.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { openCallTile, type CallTileHandle } from "@/lib/duty-tile/call-tile-manager";

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
}

const CallSurfaceContext = createContext<CallSurfaceValue | null>(null);

export function CallSurfaceProvider({ children }: { children: React.ReactNode }) {
  const [audioRings, setAudioRings] = useState<IncomingRing[]>([]);
  const [videoRings, setVideoRings] = useState<IncomingRing[]>([]);
  const [active, setActive] = useState<ActiveCallInfo | null>(null);
  // Handlers live in state, not refs: a ref write doesn't trigger a re-render,
  // so the `value` memo below would keep returning a stale `actions` snapshot
  // from before a late Softphone/video-host registration. State makes the
  // dependency real (and keeps react-hooks/exhaustive-deps honest) instead of
  // needing a synthetic version-counter dependency to force a recompute.
  const [acceptAudioFn, setAcceptAudioFn] = useState<(() => void) | null>(null);
  const [acceptVideoFn, setAcceptVideoFn] = useState<((callId: string) => void) | null>(null);
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
    if (tileHandleRef.current) return; // already open — no-op
    openCallTile(
      (handle) => {
        tileHandleRef.current = handle;
        setTileMount(handle.mount);
        setTileClosedByUser(false);
      },
      () => {
        const wasProgrammatic = programmaticCloseRef.current;
        programmaticCloseRef.current = false;
        tileHandleRef.current = null;
        setTileMount(null);
        if (!wasProgrammatic && activeRef.current) {
          setTileClosedByUser(true);
        }
      },
    );
  }, []);

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
    if (active === null) {
      closeTile();
      setTileClosedByUser(false);
    }
  }, [active, closeTile]);

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
    ],
  );

  return <CallSurfaceContext.Provider value={value}>{children}</CallSurfaceContext.Provider>;
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
