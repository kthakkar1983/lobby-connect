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
import { DUTY_ACTIVATED_EVENT } from "@/lib/duty/duty-events";

/** Nudge the incoming-video poll to re-fetch immediately (a call ringing while
 *  she was silenced won't re-surface on its own). See lib/duty/duty-events.ts. */
function nudgeIncomingVideo(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DUTY_ACTIVATED_EVENT));
}

type DutyState = {
  onDuty: boolean;
  onBreak: boolean;
  shiftStartedAt: string | null;
  accepting: boolean;
  canWork: boolean;
  /** True once the initial GET /api/presence hydration has settled (success or
   *  failure). The softphone gates its very first beat on this (spec §3.4). */
  hydrated: boolean;
  goOnDuty: () => Promise<void>;
  endShift: () => Promise<void>;
  takeBreak: () => Promise<void>;
  resume: () => Promise<void>;
  registerPrime: (fn: (() => void) | null) => void;
  registerBeat: (fn: (() => void) | null) => void; // softphone registers its beat()
  /** The softphone owns the Accepting toggle UI but this provider is the source
   *  of truth for the value (so hydration + cross-tab resync converge here); the
   *  toggle pushes its optimistic value back through this. */
  setAccepting: (value: boolean) => void;
  /** Re-read server truth (GET /api/presence) and apply it. The softphone's
   *  off-duty resync tick calls this so the HEADER converges when a shift resumes
   *  / lapses / breaks in another tab. Returns the applied onDuty/accepting (each
   *  null when the field was absent) so the caller can stamp a follow-up beat. */
  refreshFromServer: () => Promise<{ onDuty: boolean | null; accepting: boolean | null } | null>;
  /** Flip the header off duty WITHOUT a POST — the server already ended the shift
   *  (a gated beat came back {onDuty:false}); this only syncs the UI. */
  markOffDuty: () => void;
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
  const [hydrated, setHydrated] = useState(false);
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
      // Settle hydration either way (spec §3.4 fail-open): a failed read must not
      // pin the softphone's first beat forever — defaults stand, the server gate
      // is the enforcement.
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Off-duty resync read (D13 cross-tab): the softphone's off-duty tick delegates
  // its GET here so the HEADER converges when the shift changed elsewhere. Applies
  // only literal booleans (fail-open) and returns them so the caller can beat.
  const refreshFromServer = useCallback(async (): Promise<{
    onDuty: boolean | null;
    accepting: boolean | null;
  } | null> => {
    try {
      const res = await fetch("/api/presence");
      if (!res.ok) return null;
      const b = (await res.json().catch(() => null)) as
        | { onDuty?: boolean; onBreak?: boolean; accepting?: boolean; shiftStartedAt?: string | null }
        | null;
      if (!b) return null;
      const nextOnDuty = typeof b.onDuty === "boolean" ? b.onDuty : null;
      const nextAccepting = typeof b.accepting === "boolean" ? b.accepting : null;
      if (nextOnDuty !== null) setOnDuty(nextOnDuty);
      if (typeof b.onBreak === "boolean") setOnBreak(b.onBreak);
      if (nextAccepting !== null) setAccepting(nextAccepting);
      setShiftStartedAt(b.shiftStartedAt ?? null);
      return { onDuty: nextOnDuty, accepting: nextAccepting };
    } catch {
      return null;
    }
  }, []);

  // Server already ended the shift (a gated beat returned {onDuty:false}); flip
  // the header off WITHOUT re-POSTing end-shift.
  const markOffDuty = useCallback(() => {
    setOnDuty(false);
    setOnBreak(false);
    setShiftStartedAt(null);
  }, []);

  const goOnDuty = useCallback(async () => {
    primeRef.current?.(); // unlock ring autoplay (softphone element)
    // Arming notifications is a best-effort side errand and must NEVER be able
    // to fail the shift. armPush() returns false on the paths it handles, but
    // ensurePushSubscription (lib/push/sw-registration.ts:45-61) leaves
    // Notification.requestPermission() and pushManager.getSubscription()
    // unguarded — only subscribe() is wrapped — so a rejection propagates all
    // the way out here. Unguarded it would abort this function before
    // setOnDuty(true) and before the POST, and every caller invokes this as
    // `void goOnDuty()` (the ring, the off-duty prompt), so the rejection is
    // swallowed: the dialog closes looking like success while she is still off
    // duty and the server never heard. A rejection IS "not armed", so it takes
    // the same pushBlocked path as a false return and she gets the hint.
    const ok = await armPush().catch(() => false); // permission prompt INSIDE this gesture
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
    nudgeIncomingVideo(); // surface a call already ringing when she clocks in
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
    // Server is now AVAILABLE again → surface a call that rang during the break.
    nudgeIncomingVideo();
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
        hydrated,
        goOnDuty,
        endShift,
        takeBreak,
        resume,
        registerPrime,
        registerBeat,
        setAccepting,
        refreshFromServer,
        markOffDuty,
        pushBlocked,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
