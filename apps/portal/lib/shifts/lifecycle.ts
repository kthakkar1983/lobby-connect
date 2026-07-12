import { PRESENCE_STALE_AFTER_MS, SHIFT_CAP_EPSILON_MS, type ShiftEndedReason } from "@lc/shared";
import { isLiveShift } from "@/lib/voice/presence";

/** A non-manual close near the session cap is `capped`; otherwise `lapsed`. */
export function classifyShiftEnd(
  startedAtIso: string,
  endedAtIso: string,
  capMs: number,
): Extract<ShiftEndedReason, "lapsed" | "capped"> {
  const dur = Date.parse(endedAtIso) - Date.parse(startedAtIso);
  return dur >= capMs - SHIFT_CAP_EPSILON_MS ? "capped" : "lapsed";
}

/** The hard-gate predicate: on a live shift AND not on break. AWAY (heads-down
 *  remote work) is allowed; only BREAK and a lapsed/OFFLINE shift block work. */
export function canDoWork(status: string, lastSeenAt: string | null, nowMs: number): boolean {
  return isLiveShift(status, lastSeenAt, nowMs) && status !== "BREAK";
}

/** Clocked seconds for a shift. An open-but-stale shift uses its last heartbeat
 *  as the effective end so durations are accurate before the cron closes it. */
export function computeClockedSeconds(
  startedAtIso: string,
  endedAtIso: string | null,
  lastSeenAtIso: string | null,
  nowMs: number,
): number {
  const start = Date.parse(startedAtIso);
  let end: number;
  if (endedAtIso) {
    end = Date.parse(endedAtIso);
  } else {
    const lastSeen = lastSeenAtIso ? Date.parse(lastSeenAtIso) : null;
    const stale = lastSeen === null || nowMs - lastSeen > PRESENCE_STALE_AFTER_MS;
    end = stale && lastSeen !== null ? lastSeen : nowMs;
  }
  return Math.max(0, Math.round((end - start) / 1000));
}

/** Utilization % = talk-time / clocked, clamped 0..100, integer. */
export function computeUtilization(clockedSeconds: number, talkSeconds: number): number {
  if (clockedSeconds <= 0) return 0;
  return Math.min(100, Math.round((talkSeconds / clockedSeconds) * 100));
}
