"use client";
// Phase-3 call-surface context (spec D1): the Softphone and the video host
// PUBLISH their incoming/active call state here; property cards, the call
// tile, and duty controls CONSUME it. The Twilio Device / video-call machinery
// stays inside its existing owners — this is state mirroring + dispatch,
// never a second call engine.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

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
