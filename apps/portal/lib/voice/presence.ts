import { PRESENCE_STALE_AFTER_MS } from "@lc/shared";

export type PresenceStatus = "AVAILABLE" | "ON_CALL" | "AWAY" | "OFFLINE";

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

/**
 * Reachable for an outbound `<Dial>` leg = heartbeat fresh AND status AVAILABLE.
 * Built on effectivePresence, so a stale heartbeat (the daily OFFLINE sweep may
 * not have run yet) is correctly unreachable. The voice router uses this so an
 * offline/away/on-call agent is NOT dialed: at the pilot's Twilio concurrency
 * limit a dead leg would soak the single available call slot and the guest hears
 * the apology even though a reachable agent existed. See docs/v1-punchlist.md §A.
 */
export function isReachableForDial(
  status: string,
  lastSeenAt: string | null,
  nowMs: number,
): boolean {
  return effectivePresence(status, lastSeenAt, nowMs) === "AVAILABLE";
}

/** True when last_seen is missing or older than the stale window. */
export function isStale(lastSeenAtIso: string | null, now: number): boolean {
  if (!lastSeenAtIso) return true;
  const seen = Date.parse(lastSeenAtIso);
  if (Number.isNaN(seen)) return true;
  return now - seen > PRESENCE_STALE_AFTER_MS;
}
