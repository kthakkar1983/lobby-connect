import { PRESENCE_STALE_AFTER_MS, SHIFT_CAP_EPSILON_MS, type ShiftEndedReason } from "@lc/shared";

/**
 * A non-manual close near the session cap is `capped`; otherwise `lapsed`.
 *
 * KNOWN LIMITATION: the real-world trigger this detects (Supabase's 12h "Time-box
 * user sessions" Auth setting) is anchored to the AUTH SESSION's start, not the
 * SHIFT's start — but this heuristic only has the shift's own started_at to compare
 * against. An agent who logs in once and cycles through multiple go-on-duty/
 * end-shift shifts within that single login (e.g. a short shift taken after an
 * earlier break) can have a session-expiry close of that later, shorter shift
 * mislabeled `lapsed` when the true cause was the session cap. Blast radius is
 * limited to the `ended_reason` label surfaced in admin reporting —
 * computeClockedSeconds / canDoWork / duty-gating do not depend on this value.
 * Not fixed here: doing so would require threading the auth session's own start
 * time (not tracked anywhere in this app's schema) into every caller.
 */
export function classifyShiftEnd(
  startedAtIso: string,
  endedAtIso: string,
  capMs: number,
): Extract<ShiftEndedReason, "lapsed" | "capped"> {
  const dur = Date.parse(endedAtIso) - Date.parse(startedAtIso);
  return dur >= capMs - SHIFT_CAP_EPSILON_MS ? "capped" : "lapsed";
}

/**
 * The hard-gate predicate: may this agent do work right now?
 *
 * Duty/shift-liveness is RAW-STATUS — deliberately NOT staleness-based. In this
 * product an agent works heads-down in the RustDesk client with the portal tab
 * throttled/frozen, so a stale portal heartbeat is the NORMAL working state, not
 * a signal she's gone (the ring + Web Push paths already treat her as present —
 * see lib/push/targets.ts). Gating work on staleness silently 403'd a genuinely
 * on-duty agent answering a pushed video call (and blocked her RustDesk Connect).
 * So only an explicit OFFLINE (off duty — never clocked in, ended, or cron-swept)
 * or BREAK blocks work; AVAILABLE/AWAY/ON_CALL all pass.
 *
 * Reachability/online-display and the outbound audio dial keep their staleness
 * test (effectivePresence / isReachableForDial): a frozen tab genuinely can't
 * take a Twilio leg, so that asymmetry is intentional.
 */
export function canDoWork(status: string): boolean {
  return status !== "OFFLINE" && status !== "BREAK";
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
  return Math.max(0, Math.min(100, Math.round((talkSeconds / clockedSeconds) * 100)));
}
