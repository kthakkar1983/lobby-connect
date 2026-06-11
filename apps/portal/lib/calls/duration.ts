/**
 * Whole-second call duration from answeredAt to endedAtMs, clamped >= 0, or null
 * when the call was never answered. Single source for every finalizer
 * (locked decision #9 makes finalization multi-owner — this invariant must be
 * identical across the kiosk route, the agent route, and the reaper).
 */
export function computeDurationSeconds(
  answeredAt: string | null,
  endedAtMs: number,
): number | null {
  if (!answeredAt) return null;
  return Math.max(0, Math.round((endedAtMs - new Date(answeredAt).getTime()) / 1000));
}
