"use client";
// Phase-3 call-surface context (spec D1): the Softphone and the video host
// PUBLISH their incoming/active call state here; property cards, the call
// tile, and duty controls CONSUME it. The Twilio Device / Agora machinery
// stays inside its existing owners — this is state mirroring + dispatch,
// never a second call engine.

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export interface IncomingRing {
  key: string; // audio: twilio callId (or "audio"), video: calls.id
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

  const value = useMemo<CallSurfaceValue>(
    () => ({
      rings: [...audioRings, ...videoRings],
      active,
      actions: { acceptAudio: acceptAudioFn, acceptVideo: acceptVideoFn },
      publishRings,
      publishActive,
      registerAcceptAudio,
      registerAcceptVideo,
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
