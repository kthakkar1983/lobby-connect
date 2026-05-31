/**
 * A call may be transitioned to IN_PROGRESS (answered) only from RINGING.
 * Guards the race where two rung browsers both report an answer — the second
 * sees a non-RINGING state and no-ops.
 */
export function canAnswer(currentState: string): boolean {
  return currentState === "RINGING";
}
