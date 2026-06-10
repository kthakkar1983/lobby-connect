export type PresenceStatus = "AVAILABLE" | "ON_CALL" | "AWAY" | "OFFLINE";

/** A browser that hasn't checked in for this long is swept OFFLINE by cron. */
export const STALE_AFTER_MS = 90_000;

/** On login the agent is Ready (zero-friction pilot). Strict default deferred. */
export const DEFAULT_LOGIN_STATUS: PresenceStatus = "AVAILABLE";

const LIVE_STATUSES: ReadonlySet<string> = new Set([
  "AVAILABLE",
  "AWAY",
  "ON_CALL",
]);

/** Statuses a browser may set on itself. OFFLINE is cron-only. */
export function isLiveStatus(value: string): value is PresenceStatus {
  return LIVE_STATUSES.has(value);
}

/**
 * The single answer to "is this agent actually reachable right now?"
 * A DB row whose heartbeat went stale is OFFLINE regardless of what the
 * status column says — the daily sweep cron only persists what this
 * function already returns at read time.
 */
export function effectivePresence(
  status: string,
  lastSeenAt: string | null,
  nowMs: number,
): PresenceStatus {
  return isStale(lastSeenAt, nowMs) ? "OFFLINE" : (status as PresenceStatus);
}

/** True when last_seen is missing or older than the stale window. */
export function isStale(lastSeenAtIso: string | null, now: number): boolean {
  if (!lastSeenAtIso) return true;
  const seen = Date.parse(lastSeenAtIso);
  if (Number.isNaN(seen)) return true;
  return now - seen > STALE_AFTER_MS;
}
