"use client";

/**
 * DutyCard (merged duty rail, Proposal B — plan `docs/plans/2026-07-23-merged-
 * duty-rail.md`, Task 3): the dashboard right rail's top tile. Stacks the
 * softphone's idle face (line status + go-on-duty ring) above the shift's
 * clock/actions ("Your shift" → the timer + Break/End shift, or "Not on
 * duty") under ONE shared `<Card>`, separated by a 1px divider.
 *
 * <Softphone> and <ShiftCard> stay SEPARATE components with their own hooks
 * (the softphone owns the Twilio Device + consumes DutyProvider for the beat
 * gate; ShiftCard reads useDuty() directly for its own actions) -- this
 * wrapper does not merge their logic, only their chrome. Each already has its
 * own `chromeless` prop (Tasks 1-2) that drops ITS OWN outer `<Card>`, which
 * is what lets this file supply exactly one shared card instead of nesting
 * two.
 *
 * SAFETY (do not violate -- see the plan's invariant #2): the Twilio `Device`
 * is instance-local to <Softphone> and survives a re-skin in the SAME tree
 * slot, but a REMOUNT destroys it and re-registers a new one. A "no stray
 * beat after End shift" gate depends on a synchronous re-render reaching the
 * softphone. So this component must stay a PLAIN wrapper:
 *   - no React.memo, no Suspense, no lazy -- any of those can defer or
 *     interrupt the render in a way a plain element cannot;
 *   - <Softphone> below carries NO `key` prop -- a changing key is what
 *     forces React to unmount+remount an otherwise-stable instance.
 * If this ever needs to memoize or lazy-load, that has to happen ABOVE this
 * component (or not at all to the softphone's slot), never here.
 *
 * Spacing is deliberately minimal (`gap-3`) -- centering the go-on-duty ring
 * vs. pinning the shift content below the divider is visual tuning deferred
 * to Task 6 (live smoke; jsdom has no layout engine to judge it against the
 * locked mockup).
 */

import { Card } from "@/components/ui/card";
import { Softphone } from "@/components/softphone/softphone";
import { ShiftCard } from "@/components/dashboard/shift-card";

export function DutyCard({ role }: { readonly role: "ADMIN" | "AGENT" }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <Softphone role={role} chromeless />
      <div className="border-t border-border" aria-hidden="true" />
      <ShiftCard chromeless />
    </Card>
  );
}
