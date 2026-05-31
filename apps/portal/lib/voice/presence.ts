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

/** True when last_seen is missing or older than the stale window. */
export function isStale(lastSeenAtIso: string | null, now: number): boolean {
  if (!lastSeenAtIso) return true;
  const seen = Date.parse(lastSeenAtIso);
  if (Number.isNaN(seen)) return true;
  return now - seen > STALE_AFTER_MS;
}
