import type { SupabaseClient } from "@supabase/supabase-js";

import { computeDurationSeconds } from "@/lib/calls/duration";

/**
 * A call may be transitioned to IN_PROGRESS (answered) only from RINGING.
 * Guards the race where two rung browsers both report an answer — the second
 * sees a non-RINGING state and no-ops.
 */
export function canAnswer(currentState: string): boolean {
  return currentState === "RINGING";
}

/** The vocabulary of "still alive" call states. Used in finalize guards. */
export const ACTIVE_CALL_STATES = ["RINGING", "IN_PROGRESS"] as const;

/**
 * Atomically claim a RINGING call for `userId`. Self-reporting: zero touched
 * rows means a concurrent accept won (the loser must NOT proceed). Returns true
 * iff this caller is the winner. Single source for the answer-claim transaction.
 */
export async function claimCall(
  admin: SupabaseClient,
  callId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("calls")
    .update({
      state: "IN_PROGRESS",
      handled_by_user_id: userId,
      answered_at: new Date().toISOString(),
    })
    .eq("id", callId)
    .eq("state", "RINGING")
    .select("id");
  return !!data && data.length > 0;
}

/**
 * Kiosk-side atomic claim of an OUTBOUND call: RINGING -> IN_PROGRESS + answered_at,
 * scoped to the property + direction. Unlike claimCall it does NOT set
 * handled_by_user_id — for an outbound call that is already the originating
 * agent and must be preserved. Returns { channelName, operatorId } on success
 * (operatorId is needed by the caller to broadcast calls-changed, matching
 * call-ended's convention of broadcasting by operator_id, not property_id),
 * or null if not claimed (already answered / cancelled / timed out).
 */
export async function claimOutboundByKiosk(
  admin: SupabaseClient,
  callId: string,
  propertyId: string,
): Promise<{ channelName: string; operatorId: string } | null> {
  const { data } = await admin
    .from("calls")
    .update({ state: "IN_PROGRESS", answered_at: new Date().toISOString() })
    .eq("id", callId)
    .eq("property_id", propertyId)
    .eq("direction", "OUTBOUND")
    .eq("state", "RINGING")
    .select("id, agora_channel_name, operator_id");
  const row = data?.[0];
  if (!row || !row.agora_channel_name) return null;
  return { channelName: row.agora_channel_name, operatorId: row.operator_id };
}

type FinalState = "COMPLETED" | "NO_ANSWER" | "FAILED";

/** The kiosk's end `reason` → finalize state. "cancelled" is a guest who hung up. */
const STATE_BY_REASON: Record<string, FinalState> = {
  completed: "COMPLETED",
  "no-answer": "NO_ANSWER",
  cancelled: "NO_ANSWER",
  failed: "FAILED",
};

/**
 * Resolve the finalize state from the kiosk's end `reason`, enforcing the
 * invariant that an ANSWERED call can never be NO_ANSWER.
 *
 * A concurrent accept (both rung browsers accepted — possible while video was
 * broadcast to every agent) or a guest tapping End on a connected call makes the
 * kiosk's teardown report "cancelled"/"no-answer" for a call an agent already
 * claimed. Without this guard that answered call was stamped NO_ANSWER (a real
 * pilot row: `answered_at` + `handled_by` set, yet state NO_ANSWER) — a connected
 * call mislabeled as missed. If it was answered, a cancel/no-answer reason means
 * it connected then ended → COMPLETED. (A genuine `failed` stays FAILED.)
 */
export function resolveFinalState(reason: string | undefined, answered: boolean): FinalState {
  const base = STATE_BY_REASON[reason ?? "completed"] ?? "COMPLETED";
  if (answered && base === "NO_ANSWER") return "COMPLETED";
  return base;
}

/** State-guarded finalize payload (COMPLETED/NO_ANSWER/FAILED). Caller keeps its own `.eq/.in(state)` write guard. */
export function finalizeCallPayload(
  state: "COMPLETED" | "NO_ANSWER" | "FAILED",
  answeredAt: string | null,
  endedAt: Date,
): { state: "COMPLETED" | "NO_ANSWER" | "FAILED"; ended_at: string; duration_seconds: number | null } {
  return {
    state,
    ended_at: endedAt.toISOString(),
    duration_seconds: computeDurationSeconds(answeredAt, endedAt.getTime()),
  };
}
