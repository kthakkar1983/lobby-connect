import type { CallState, CallDirection, IncidentStatus } from "@lc/shared";
import { callStateLabel, incidentStatusLabel } from "./format";

export type Pill = { readonly label: string; readonly className: string };

const CALL_PILL_CLASS: Record<CallState, string> = {
  COMPLETED: "bg-live/15 text-live-foreground",
  IN_PROGRESS: "bg-live/15 text-live-foreground",
  RINGING: "bg-muted text-muted-foreground",
  NO_ANSWER: "bg-attention/15 text-attention-text",
  FAILED: "bg-muted text-muted-foreground",
};

/**
 * Status pill for a call. An OUTBOUND NO_ANSWER (agent-placed call-back the guest
 * didn't pick up) gets a neutral pill + "No answer" label, not the blaze/attention
 * "Missed" pill — that implies a guest couldn't reach the front desk. `direction`
 * defaults to "INBOUND" so every existing caller stays byte-identical.
 */
export function callPill(state: CallState, direction: CallDirection = "INBOUND"): Pill {
  if (state === "NO_ANSWER" && direction === "OUTBOUND") {
    return { label: "No answer", className: "bg-muted text-muted-foreground" };
  }
  return { label: callStateLabel(state), className: CALL_PILL_CLASS[state] };
}

export function incidentPill(status: IncidentStatus): Pill {
  return {
    label: incidentStatusLabel(status),
    className:
      status === "RESOLVED"
        ? "bg-muted text-muted-foreground"
        : "bg-attention/15 text-attention-text",
  };
}
