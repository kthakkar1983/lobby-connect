import type { CallState, CallDirection, IncidentStatus } from "@lc/shared";
import { callStateLabel, incidentStatusLabel } from "./format";

/** Mirrors StatusBadge's `variant` union (components/ui/status-badge.tsx). */
export type PillVariant = "live" | "accent" | "attention" | "muted";
export type Pill = { readonly label: string; readonly variant: PillVariant };

const CALL_PILL_VARIANT: Record<CallState, PillVariant> = {
  COMPLETED: "live",
  IN_PROGRESS: "live",
  RINGING: "muted",
  NO_ANSWER: "attention",
  FAILED: "muted",
};

/**
 * Status pill for a call. An OUTBOUND NO_ANSWER (agent-placed call-back the guest
 * didn't pick up) gets a neutral pill + "No answer" label, not the blaze/attention
 * "Missed" pill — that implies a guest couldn't reach the front desk. `direction`
 * defaults to "INBOUND" so every existing caller stays byte-identical.
 *
 * The label is ALWAYS delegated to callStateLabel(state, direction) — the single
 * source of the "No answer" string — so this function only owns the variant
 * branch (the neutral vs. blaze decision). Do not re-inline the label here.
 */
export function callPill(state: CallState, direction: CallDirection = "INBOUND"): Pill {
  const label = callStateLabel(state, direction);
  const variant: PillVariant =
    state === "NO_ANSWER" && direction === "OUTBOUND" ? "muted" : CALL_PILL_VARIANT[state];
  return { label, variant };
}

export function incidentPill(status: IncidentStatus): Pill {
  return {
    label: incidentStatusLabel(status),
    variant: status === "RESOLVED" ? "muted" : "attention",
  };
}
