import { PRESENCE_STALE_AFTER_MS, type Role } from "@lc/shared";

export type PresenceStatus = "AVAILABLE" | "ON_CALL" | "AWAY" | "OFFLINE";

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
 * D13: is this agent's SHIFT live right now? Built on effectivePresence, so a
 * shift is over when explicitly ended (raw OFFLINE), swept, or lapsed past
 * PRESENCE_STALE_AFTER_MS. The heartbeat route refuses to refresh a non-live
 * shift; POST /api/presence/go-on-duty is the only way back in.
 */
export function isLiveShift(
  status: string,
  lastSeenAt: string | null,
  nowMs: number,
): boolean {
  return effectivePresence(status, lastSeenAt, nowMs) !== "OFFLINE";
}

/**
 * Reachable for an outbound `<Dial>` leg = heartbeat fresh AND status is "online"
 * (AVAILABLE or ON_CALL) — i.e. the same definition the dashboard uses for an online
 * agent (see countOnlineAgents). Built on effectivePresence, so a stale heartbeat
 * (the daily OFFLINE sweep may not have run yet) is correctly unreachable.
 *
 * ON_CALL is reachable: an agent who just finished — or is wrapping up — a call is
 * briefly ON_CALL (e.g. right after a video call, or pinned by a leaked IN_PROGRESS
 * row), and must still receive the next call. Requiring status === "AVAILABLE"
 * exactly black-holed a real pilot call: the assigned agent was ON_CALL ~20s after a
 * video call, so the gate skipped her and the guest heard the apology while she sat
 * idle. Only an explicit AWAY (opted out) or a stale/OFFLINE heartbeat is unreachable.
 *
 * The router uses this so an offline/away agent isn't dialed: at the pilot's Twilio
 * concurrency limit a dead leg would soak the single call slot. See docs/v1-punchlist.md §A.
 */
export function isReachableForDial(
  status: string,
  lastSeenAt: string | null,
  nowMs: number,
): boolean {
  const effective = effectivePresence(status, lastSeenAt, nowMs);
  return effective === "AVAILABLE" || effective === "ON_CALL";
}

/**
 * Roles that run a softphone and therefore report presence. OWNERs have no
 * softphone and never heartbeat, so surfaces that list users show "—" for an
 * owner rather than a misleading OFFLINE. AGENT + ADMIN are the call-takers.
 */
export function roleHasPresence(role: Role): boolean {
  return role === "AGENT" || role === "ADMIN";
}

/** True when last_seen is missing or older than the stale window. */
export function isStale(lastSeenAtIso: string | null, now: number): boolean {
  if (!lastSeenAtIso) return true;
  const seen = Date.parse(lastSeenAtIso);
  if (Number.isNaN(seen)) return true;
  return now - seen > PRESENCE_STALE_AFTER_MS;
}
