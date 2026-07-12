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
 * Reads useDuty() (Task 14) only for state + the four handlers; it owns no
 * duty state itself. Call-awareness (hiding "Take a break" mid-call) is
 * deliberately NOT wired here per the plan — v1 keeps the pill simple.
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Coffee, LogOut } from "lucide-react";
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

function DutyMenu({ onEndShift }: { readonly onEndShift: () => void }) {
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
        <DropdownMenuItem onSelect={onEndShift}>
          <LogOut aria-hidden="true" />
          End shift
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DutyControl() {
  const { onDuty, onBreak, shiftStartedAt, goOnDuty, endShift, takeBreak, resume } = useDuty();
  const elapsed = useElapsedLabel(shiftStartedAt);

  if (!onDuty) {
    return (
      <div className={WRAPPER_CLASS}>
        <Button onClick={() => void goOnDuty()}>Go on duty</Button>
      </div>
    );
  }

  if (onBreak) {
    return (
      <div className={WRAPPER_CLASS}>
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
        <DutyMenu onEndShift={() => void endShift()} />
      </div>
    );
  }

  return (
    <div className={WRAPPER_CLASS}>
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
      <Button variant="outline" size="sm" onClick={() => void takeBreak()}>
        Take a break
      </Button>
      <DutyMenu onEndShift={() => void endShift()} />
    </div>
  );
}
