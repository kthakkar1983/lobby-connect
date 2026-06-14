export type { CallState } from "@lc/shared";
import type { CallState } from "@lc/shared";

const TERMINAL: ReadonlySet<CallState> = new Set([
  "COMPLETED",
  "NO_ANSWER",
  "FAILED",
]);

export function isTerminalState(state: CallState): boolean {
  return TERMINAL.has(state);
}

/**
 * Decide what /dial-result should do given Twilio's DialCallStatus.
 * `completed` means the call was answered and has now ended.
 */
export function resolveDialResult(dialCallStatus: string): {
  finalState: CallState;
  hangup: boolean;
} {
  if (dialCallStatus === "completed") {
    return { finalState: "COMPLETED", hangup: true };
  }
  return { finalState: "NO_ANSWER", hangup: false };
}

/** Map a Twilio call StatusCallback CallStatus to a terminal CallState, or null. */
export function mapFinalCallState(callStatus: string): CallState | null {
  switch (callStatus) {
    case "completed":
      return "COMPLETED";
    case "failed":
    case "canceled":
      return "FAILED";
    case "busy":
    case "no-answer":
      return "NO_ANSWER";
    default:
      return null;
  }
}

export function parseDurationSeconds(
  raw: string | null | undefined,
): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}
