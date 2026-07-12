"use client";

/**
 * Task 14 (shift-tracking plan): owns duty/break state across the dashboard,
 * hydrating from GET /api/presence and driving the four duty-transition
 * routes (go-on-duty/end-shift/take-break/resume). Deliberately separate from
 * CallSurfaceProvider (that firewall against render loops must be preserved —
 * see call-surface-provider.tsx) — this context owns none of the softphone's
 * ring/audio surfaces, only duty state.
 *
 * registerPrime/registerBeat are refs-based seams (mirrors
 * CallSurfaceProvider.registerAcceptAudio): the softphone registers its real
 * ring-prime + heartbeat-beat functions on mount so goOnDuty()/resume() can
 * invoke them without this provider ever owning the <audio> element or the
 * heartbeat loop.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { armPush } from "@/lib/push/client";

type DutyState = {
  onDuty: boolean;
  onBreak: boolean;
  shiftStartedAt: string | null;
  accepting: boolean;
  canWork: boolean;
  goOnDuty: () => Promise<void>;
  endShift: () => Promise<void>;
  takeBreak: () => Promise<void>;
  resume: () => Promise<void>;
  registerPrime: (fn: (() => void) | null) => void;
  registerBeat: (fn: (() => void) | null) => void; // softphone registers its beat()
  pushBlocked: boolean;
};

const Ctx = createContext<DutyState | null>(null);

export function useDuty(): DutyState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDuty must be used within DutyProvider");
  return v;
}

export function useDutyOptional(): DutyState | null {
  return useContext(Ctx);
}

export function DutyProvider({ children }: { readonly children: React.ReactNode }) {
  const [onDuty, setOnDuty] = useState(true); // fail-open default; hydration corrects
  const [onBreak, setOnBreak] = useState(false);
  const [shiftStartedAt, setShiftStartedAt] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(true);
  const [pushBlocked, setPushBlocked] = useState(false);
  const primeRef = useRef<(() => void) | null>(null);
  const beatRef = useRef<(() => void) | null>(null);

  const registerPrime = useCallback((fn: (() => void) | null) => {
    primeRef.current = fn;
  }, []);
  const registerBeat = useCallback((fn: (() => void) | null) => {
    beatRef.current = fn;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/presence");
        if (res.ok) {
          const b = (await res.json().catch(() => null)) as
            | { onDuty?: boolean; onBreak?: boolean; accepting?: boolean; shiftStartedAt?: string | null }
            | null;
          if (b && !cancelled) {
            if (typeof b.onDuty === "boolean") setOnDuty(b.onDuty);
            if (typeof b.onBreak === "boolean") setOnBreak(b.onBreak);
            if (typeof b.accepting === "boolean") setAccepting(b.accepting);
            setShiftStartedAt(b.shiftStartedAt ?? null);
          }
        }
      } catch {
        /* fail-open */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const goOnDuty = useCallback(async () => {
    primeRef.current?.(); // unlock ring autoplay (softphone element)
    const ok = await armPush(); // permission prompt INSIDE this gesture
    setPushBlocked(!ok);
    setOnDuty(true);
    setOnBreak(false);
    await fetch("/api/presence/go-on-duty", { method: "POST" }).catch(() => {});
    // refetch shiftStartedAt (a new shift just opened)
    try {
      const res = await fetch("/api/presence");
      const b = res.ok ? await res.json().catch(() => null) : null;
      if (b) setShiftStartedAt(b.shiftStartedAt ?? null);
    } catch {
      /* ignore */
    }
    beatRef.current?.();
  }, []);

  const endShift = useCallback(async () => {
    setOnDuty(false);
    setOnBreak(false);
    setShiftStartedAt(null);
    await fetch("/api/presence/end-shift", { method: "POST" }).catch(() => {});
  }, []);

  const takeBreak = useCallback(async () => {
    setOnBreak(true);
    await fetch("/api/presence/take-break", { method: "POST" }).catch(() => {});
  }, []);

  const resume = useCallback(async () => {
    setOnBreak(false);
    await fetch("/api/presence/resume", { method: "POST" }).catch(() => {});
    beatRef.current?.();
  }, []);

  const canWork = onDuty && !onBreak;

  return (
    <Ctx.Provider
      value={{
        onDuty,
        onBreak,
        shiftStartedAt,
        accepting,
        canWork,
        goOnDuty,
        endShift,
        takeBreak,
        resume,
        registerPrime,
        registerBeat,
        pushBlocked,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
