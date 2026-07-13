"use client";

/**
 * Task 15 (shift-tracking plan): the constant-size header duty control (spec
 * §8.1). Renders in the DashboardHeader's children slot (Task 16 wires the
 * mount) alongside AccountMenu, on the navy→teal gradient band — so its
 * chrome mirrors AccountMenu's light-on-navy treatment (a bg-card/bg-background
 * chip reads on the dark header; solid mint/blaze fills carry duty/break state).
 *
 * Fixed footprint (spec §8.1): the outer wrapper is a constant `w-[20rem]`
 * across every state (off / on duty / on break) so the header never reflows
 * as an agent's shift changes — verified directly in duty-control.test.tsx.
 *
 * Reads useDuty() (Task 14) for state + the four handlers + pushBlocked; it owns
 * no duty state itself. Call-awareness (finding #2): it also reads the live call
 * from useCallSurfaceOptional() so that, while a call is in progress, it HIDES
 * "Take a break" (spec §8.1 "on a call → break hidden" — taking a break mid-call
 * would corrupt the timesheet) and DISABLES "End shift" (ending now un-clocks the
 * call tail). A denied Web Push permission surfaces a quiet BellOff hint (finding
 * #4) — alerting is mandatory for this product, so a silent denial is a real gap.
 */

import { useEffect, useMemo, useState } from "react";
import { BellOff, ChevronDown, Coffee, LogOut } from "lucide-react";
import { useCallSurfaceOptional } from "@/components/dashboard/call-surface-provider";
import { useDuty } from "@/components/dashboard/duty-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const WRAPPER_CLASS = "flex w-[20rem] shrink-0 items-center justify-end gap-2";

/** "Hh Mm" elapsed since `startedAtIso`, ticking on a light interval (a live
 *  pill, not a stopwatch — minute-granularity is all the header needs). */
function useElapsedLabel(startedAtIso: string | null): string {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAtIso) return;
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [startedAtIso]);

  return useMemo(() => {
    if (!startedAtIso) return "0h 00m";
    const elapsedMs = Math.max(0, nowMs - Date.parse(startedAtIso));
    const totalMinutes = Math.floor(elapsedMs / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }, [startedAtIso, nowMs]);
}

function DutyMenu({
  onEndShift,
  endShiftDisabled = false,
}: {
  readonly onEndShift: () => void;
  /** True while a call is live (finding #2b): ending the shift now would close
   *  it at now() mid-call and un-clock the call tail, so the item is disabled
   *  with a reason. Mirrors the old duty-controls.tsx "Finish the call first". */
  readonly endShiftDisabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Duty menu"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-background/90 text-foreground outline-none transition-shadow hover:ring-2 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={onEndShift}
          disabled={endShiftDisabled}
          title={endShiftDisabled ? "Finish the call first" : undefined}
        >
          <LogOut aria-hidden="true" />
          End shift
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A quiet BellOff shown when Web Push was denied (finding #4). Sits inside the
 *  fixed w-[20rem] wrapper, so it never changes the header's footprint. */
function NotificationsBlockedHint() {
  const message = "Notifications blocked — rings still work in this tab";
  return (
    <span
      role="img"
      aria-label={message}
      title={message}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-background/90 text-attention-text"
    >
      <BellOff size={14} aria-hidden="true" />
    </span>
  );
}

export function DutyControl() {
  const { onDuty, onBreak, shiftStartedAt, pushBlocked, goOnDuty, endShift, takeBreak, resume } =
    useDuty();
  // Call-awareness (finding #2): the live call, if any. useCallSurfaceOptional so
  // this still renders (call-unaware) outside a CallSurfaceProvider — owner
  // surfaces + the presentational duty-control test.
  const onCall = useCallSurfaceOptional()?.active != null;
  const elapsed = useElapsedLabel(shiftStartedAt);

  if (!onDuty) {
    return (
      <div className={WRAPPER_CLASS}>
        <Button onClick={() => void goOnDuty()}>Go on duty</Button>
      </div>
    );
  }

  // A denied push permission shows a quiet BellOff on live shifts (finding #4).
  const blockedHint = pushBlocked ? <NotificationsBlockedHint /> : null;

  if (onBreak) {
    return (
      <div className={WRAPPER_CLASS}>
        {blockedHint}
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full bg-attention px-3 py-1.5",
            "text-sm font-semibold text-attention-foreground",
          )}
        >
          <Coffee size={14} aria-hidden="true" />
          On break
        </span>
        <Button variant="outline" size="sm" onClick={() => void resume()}>
          Resume
        </Button>
        {/* End shift stays disabled mid-call even on a break, for symmetry. */}
        <DutyMenu onEndShift={() => void endShift()} endShiftDisabled={onCall} />
      </div>
    );
  }

  return (
    <div className={WRAPPER_CLASS}>
      {blockedHint}
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-live px-3 py-1.5",
          "font-mono text-sm font-semibold text-ink",
        )}
      >
        <span
          className="inline-block size-2 rounded-full bg-ink/70 motion-safe:animate-pulse motion-reduce:animate-none"
          aria-hidden="true"
        />
        On duty · {elapsed}
      </span>
      {/* Break is hidden mid-call (spec §8.1 / finding #2a): you can't take a
          break on a call, and a heartbeat that clobbered BREAK would corrupt the
          timesheet. */}
      {!onCall && (
        <Button variant="outline" size="sm" onClick={() => void takeBreak()}>
          Take a break
        </Button>
      )}
      <DutyMenu onEndShift={() => void endShift()} endShiftDisabled={onCall} />
    </div>
  );
}
