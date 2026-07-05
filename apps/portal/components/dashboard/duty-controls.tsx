"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

import { armPush, pushArmed } from "@/lib/push/client";
import { cn } from "@/lib/utils";

interface DutyControlsProps {
  readonly role: "AGENT" | "ADMIN";
  /** Primes the softphone's real ring element (autoplay unlock) via a prop. */
  readonly onPrime: () => void;
  /** Whether the agent is on shift. False after "End shift" (push stays armed). */
  readonly onDuty: boolean;
  /** End shift is disabled mid-call/mid-ring (the softphone computes this). */
  readonly canEndShift: boolean;
  /** Flip presence to OFFLINE + disarm the heartbeat (owned by the softphone). */
  readonly onEndShift: () => void;
  /** Re-arm the heartbeat + beat immediately (owned by the softphone). */
  readonly onResumeDuty: () => void;
}

/**
 * D5/D6 duty control (Phase 3, spec §3). One card section that owns the two
 * shift boundaries:
 *
 * 1. "Go on duty" — in one deliberate click: primes the ring audio (autoplay
 *    unlock, via onPrime → the softphone's real element), arms Web Push (the
 *    permission prompt + subscription, INSIDE this user gesture), and resumes
 *    duty (re-arms the heartbeat; idempotent if already on duty).
 * 2. "End shift" — flips presence to OFFLINE immediately + disarms the heartbeat
 *    (via onEndShift). A NEUTRAL control, not red: red is 911/destructive only,
 *    and ending a shift is neither.
 *
 * Presentational + props-driven (Task-14 architecture): rendered BY the Softphone,
 * which owns onDuty + the endShift/resumeDuty handlers and passes them down. NO
 * state lift into the CallSurfaceProvider → zero render-loop risk. The
 * push-arming (`armed`) is the only state this component owns locally.
 *
 * The FULLY-ACTIVE state is `armed && onDuty`: after End shift, `armed` stays
 * true (the push subscription persists) but `onDuty` is false, so the "On duty"
 * card must NOT show — the Go-on-duty button returns to resume.
 */
export function DutyControls({
  role: _role,
  onPrime,
  onDuty,
  canEndShift,
  onEndShift,
  onResumeDuty,
}: DutyControlsProps) {
  const [armed, setArmed] = useState(false);
  const [blocked, setBlocked] = useState(false);

  // pushArmed() reads Notification.permission — client-only, so resolve it after
  // mount (SSR + the softphone test's jsdom without PushManager both see false).
  useEffect(() => {
    setArmed(pushArmed());
  }, []);

  if (armed && onDuty) {
    return (
      <div className="mt-3 flex flex-col items-center gap-2">
        <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-live-foreground">
          <ShieldCheck size={14} aria-hidden="true" />
          <span>On duty · push armed</span>
        </div>
        <button
          type="button"
          onClick={onEndShift}
          disabled={!canEndShift}
          title={!canEndShift ? "Finish the call first" : undefined}
          className={cn(
            "w-full rounded-button border border-border px-3 py-2 font-medium",
            "text-text-muted transition-colors hover:bg-muted disabled:opacity-50",
          )}
        >
          End shift
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3">
      {!onDuty && (
        <p className="mb-2 text-center text-xs text-text-muted">Off duty</p>
      )}
      <button
        type="button"
        onClick={async () => {
          onPrime(); // primes the softphone ring element (real element, via prop)
          const ok = await armPush(); // permission prompt INSIDE this user gesture
          const nowArmed = ok && pushArmed();
          setArmed(nowArmed);
          setBlocked(!ok);
          onResumeDuty(); // idempotent if on duty; re-arms the heartbeat after End shift
        }}
        className={cn(
          "w-full rounded-button border border-transparent bg-live/15 px-3 py-2",
          "font-medium text-live-foreground transition-colors hover:bg-live/25",
        )}
      >
        {onDuty ? "Go on duty" : "Go on duty to resume"}
      </button>
      {blocked && (
        <p className="mt-2 text-center text-xs text-text-muted">
          Notifications blocked — rings still work in this tab.
        </p>
      )}
    </div>
  );
}
