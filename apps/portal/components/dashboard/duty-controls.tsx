"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

import { armPush, pushArmed } from "@/lib/push/client";
import { cn } from "@/lib/utils";

interface DutyControlsProps {
  readonly role: "AGENT" | "ADMIN";
  /** Primes the softphone's real ring element (autoplay unlock) via a prop. */
  readonly onPrime: () => void;
}

/**
 * D5 "Go on duty": one deliberate click that (1) primes the ring audio (autoplay
 * unlock, via onPrime → the softphone's real element) and (2) arms Web Push (the
 * permission prompt + subscription, INSIDE this user gesture).
 *
 * Presentational + self-contained: rendered BY the Softphone inside its idle
 * card block, receiving `onPrime` as a prop. It owns ONLY the push-arming
 * concern — all duty/call state stays in the Softphone (no state lift into the
 * CallSurfaceProvider), so this adds zero render-loop risk. It renders as a
 * section of the softphone card, not its own bordered card.
 */
export function DutyControls({ role: _role, onPrime }: DutyControlsProps) {
  const [armed, setArmed] = useState(false);
  const [blocked, setBlocked] = useState(false);

  // pushArmed() reads Notification.permission — client-only, so resolve it after
  // mount (SSR + the softphone test's jsdom without PushManager both see false).
  useEffect(() => {
    setArmed(pushArmed());
  }, []);

  if (armed) {
    return (
      <div className="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-live-foreground">
        <ShieldCheck size={14} aria-hidden="true" />
        <span>On duty · push armed</span>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={async () => {
          onPrime(); // primes the softphone ring element (real element, via prop)
          const ok = await armPush(); // permission prompt INSIDE this user gesture
          const nowArmed = ok && pushArmed();
          setArmed(nowArmed);
          if (!ok) setBlocked(true);
          else setBlocked(false);
        }}
        className={cn(
          "w-full rounded-button border border-transparent bg-live/15 px-3 py-2",
          "font-medium text-live-foreground transition-colors hover:bg-live/25",
        )}
      >
        Go on duty
      </button>
      {blocked && (
        <p className="mt-2 text-center text-xs text-text-muted">
          Notifications blocked — rings still work in this tab.
        </p>
      )}
    </div>
  );
}
