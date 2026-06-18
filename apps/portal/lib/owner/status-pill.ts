import type { CallState, IncidentStatus } from "@lc/shared";
import { callStateLabel, incidentStatusLabel } from "./format";

export type Pill = { readonly label: string; readonly className: string };

const CALL_PILL_CLASS: Record<CallState, string> = {
  COMPLETED: "bg-live/15 text-live-foreground",
  IN_PROGRESS: "bg-live/15 text-live-foreground",
  RINGING: "bg-muted text-muted-foreground",
  NO_ANSWER: "bg-attention/15 text-attention-text",
  FAILED: "bg-muted text-muted-foreground",
};

export function callPill(state: CallState): Pill {
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
