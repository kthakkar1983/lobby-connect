"use client";

/**
 * The shift half of the dashboard's right column (spec §3.3), replacing the
 * header's DutyControl (retired in Task 10). This RELOCATES controls: it changes
 * no duty semantics and touches none of the four /api/presence routes. End shift
 * stops hiding behind a ChevronDown and becomes a first-class labelled button,
 * which is what absorbs the two outstanding time-tracker polish items (spec §3.5).
 *
 * THREE RULES CARRIED OVER FROM duty-control.tsx, none of them polish. That file
 * was deleted in commit 534b37e; the line numbers below resolve at 534b37e^:
 *
 *   - END SHIFT IS BLOCKED MID-CALL (duty-control.tsx:83-84). Ending now closes
 *     the shift at now() and un-clocks the call tail. Applied on BOTH the
 *     on-duty and the on-break branch (:146-147, :175) -- that symmetry is
 *     deliberate: ending from a break mid-call loses the same tail.
 *   - BREAK IS REMOVED MID-CALL, not disabled (:167-174). You cannot take a
 *     break on a call, and a heartbeat that clobbered BREAK would corrupt the
 *     timesheet.
 *   - A DENIED WEB PUSH IS SURFACED (:94-108). duty-control.tsx was the repo's
 *     ONLY consumer of pushBlocked, so once it goes this card is the only place
 *     left to say so. On a product whose alerting contract is "she can always
 *     hear it ring", a silent denial means she believes she is covered while
 *     OS-level alerting is off -- so the hint shows in ALL THREE states, and it
 *     matters MOST off duty, which is the one state the header never covered:
 *     right before a shift starts is when she can still fix it.
 *
 * Deliberately absent (spec D4/D5): a "calls tonight" figure (already on the
 * chart) and a "last shift" readout (net-new agent-facing plumbing for a state
 * lasting seconds). "Line ready" and "Accepting" belong to the softphone card
 * directly above -- duplicating them here would be worse than the dead space
 * this card fills.
 */

import { useEffect, useState } from "react";
import { BellOff, Coffee, LogOut, Play } from "lucide-react";
import { useCallSurfaceOptional } from "@/components/dashboard/call-surface-provider";
import { useDuty } from "@/components/dashboard/duty-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * The shift start as epoch ms, or NaN if there isn't a usable one.
 *
 * Nothing upstream guarantees a date string: duty-provider.tsx:100 and :135
 * assign `b.shiftStartedAt ?? null` straight off untrusted JSON, without the
 * `typeof === "boolean"` validation they apply to onDuty/onBreak. An
 * unparseable value would reach `elapsed` as NaN, and `Math.max(0, NaN)` is
 * NaN — the zero-clamp below does not cover it — so the card would render
 * "NaN:NaN:NaN" as a 3xl headline over "On duty since Invalid Date".
 *
 * So an unusable start time is treated exactly like a missing one: withhold the
 * figures, keep the actions. Same reasoning as the `shiftStartedAt: null`
 * transient documented on the render branch below — the actions must never
 * depend on a figure we could not compute.
 */
function startMsOf(startedAtIso: string | null): number {
  return startedAtIso === null ? Number.NaN : Date.parse(startedAtIso);
}

/** Elapsed shift as H:MM:SS. Clamped at zero so clock skew reads 0:00:00, not a
 *  negative stopwatch. Hours are deliberately unbounded: the 10h MAX_SHIFT_MS
 *  cap is enforced server-side by the daily cron, so she can be looking at this
 *  card while a shift is over cap, and a wrapped reading would misreport it as
 *  one that just started. */
function elapsed(startMs: number, nowMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, nowMs - startMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Shift start on HER clock, 24-hour. `hour12: false` is explicit rather than
 *  locale-dependent: the spec writes it HH:MM, and the clocks card below reads
 *  24-hour for the same AM/PM-ambiguity reason. */
function startedAtLabel(startMs: number): string {
  return new Date(startMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Visible, not an icon-only chip with an aria-label. The header that carried
 *  this had no room for the sentence; a 340px card does, and the tooltip-only
 *  version was discoverable by hover alone. */
function NotificationsBlockedHint() {
  return (
    <p className="flex items-start gap-1.5 text-xs text-attention-text">
      <BellOff size={14} aria-hidden="true" className="mt-px shrink-0" />
      Notifications blocked — rings still work in this tab
    </p>
  );
}

function EndShiftButton({
  onCall,
  onEndShift,
}: {
  readonly onCall: boolean;
  readonly onEndShift: () => void;
}) {
  const reason = onCall ? "Finish the call first" : undefined;
  return (
    // The Button base carries `disabled:pointer-events-none`, so a title on a
    // disabled button never surfaces on hover. The wrapper is the hover target
    // that actually shows the reason -- same recipe as PropertyActionButton.
    // Note this makes the reason reachable by SIGHTED HOVER only: a native
    // `title` on a button that already has text content is generally not
    // announced by NVDA or JAWS, which take the accessible name from the
    // content. That is exact parity with the retired duty-control.tsx:84, so it
    // is not a regression -- but it is not an a11y guarantee either, and if it
    // is ever fixed it should be fixed on PropertyActionButton at the same time
    // so the two do not drift.
    <span className="flex-1" title={reason}>
      <Button
        type="button"
        variant="neutral"
        size="sm"
        className="w-full whitespace-nowrap"
        disabled={onCall}
        // Kept in step with the wrapper deliberately. The WRAPPER is the working
        // hover mechanism (above); this one is what shift-card.test.tsx asserts,
        // so dropping it silently loses that assertion's subject.
        title={reason}
        onClick={onEndShift}
      >
        <LogOut aria-hidden="true" />
        End shift
      </Button>
    </span>
  );
}

const CARD_LABEL = (
  <p className="font-label text-[11px] font-semibold uppercase tracking-[0.09em] text-text-muted">
    Your shift
  </p>
);

export function ShiftCard() {
  const { onDuty, onBreak, shiftStartedAt, pushBlocked, endShift, takeBreak, resume } = useDuty();
  // The live call, for the two mid-call rules above. The OPTIONAL hook, so this
  // card still renders outside a CallSurfaceProvider.
  const onCall = useCallSurfaceOptional()?.active != null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  const startMs = startMsOf(shiftStartedAt);
  const hasStart = Number.isFinite(startMs);

  // Per-second only while there is a running clock to move. An agent parked off
  // duty all evening should not be re-rendering 3600 times an hour to update
  // nothing. Gated on `hasStart` rather than on the raw string, so an
  // unparseable start time does not spin an interval whose output is withheld.
  useEffect(() => {
    if (!onDuty || !hasStart) return;
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [onDuty, hasStart]);

  const blockedHint = pushBlocked ? <NotificationsBlockedHint /> : null;

  if (!onDuty) {
    return (
      <Card className="gap-3 p-4">
        {CARD_LABEL}
        <p className="text-sm text-text-muted">Not on duty</p>
        {blockedHint}
      </Card>
    );
  }

  // NOTE the branch above is on `onDuty` ALONE, not on `onDuty && shiftStartedAt`.
  // DutyProvider mounts onDuty=true (fail-open) with shiftStartedAt=null until
  // GET /api/presence lands, so a missing start time is an ordinary transient,
  // not proof she is off duty. Reading it as off duty would flash a false
  // "Not on duty" on every mount -- and if the start time never arrived it would
  // strand her with no way to end the shift, now that the header has no duty
  // control at all. So: withhold the figures we do not have, keep the actions.
  return (
    <Card className="gap-3 p-4">
      {CARD_LABEL}
      <div>
        {hasStart ? (
          // tabular-nums matters here specifically: this re-renders every second,
          // and proportional digits would jitter the whole line.
          <p className="font-mono text-3xl font-semibold tabular-nums tracking-tight">
            {elapsed(startMs, nowMs)}
          </p>
        ) : null}
        {onBreak ? (
          <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-attention px-2.5 py-1 text-xs font-semibold text-attention-foreground">
            <Coffee size={13} aria-hidden="true" />
            On break
          </span>
        ) : (
          <p className="mt-0.5 text-xs text-text-muted tabular-nums">
            {hasStart ? `On duty since ${startedAtLabel(startMs)}` : "On duty"}
          </p>
        )}
      </div>
      {blockedHint}
      <div className="flex gap-2 border-t border-border pt-3">
        {onBreak ? (
          <Button
            type="button"
            variant="neutral"
            size="sm"
            className="flex-1 whitespace-nowrap"
            onClick={() => void resume()}
          >
            <Play aria-hidden="true" />
            Resume
          </Button>
        ) : onCall ? null : (
          <Button
            type="button"
            variant="neutral"
            size="sm"
            className="flex-1 whitespace-nowrap"
            onClick={() => void takeBreak()}
          >
            <Coffee aria-hidden="true" />
            Break
          </Button>
        )}
        <EndShiftButton onCall={onCall} onEndShift={() => void endShift()} />
      </div>
    </Card>
  );
}
