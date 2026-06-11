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
