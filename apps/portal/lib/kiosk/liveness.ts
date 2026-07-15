import { KIOSK_STALE_AFTER_MS } from "@lc/shared";

/**
 * A kiosk is online iff its last heartbeat/poll is within the staleness window.
 * Mirrors the read-time shape of effectivePresence/isStale for agent presence.
 * Fresh-only: the 30s kiosk heartbeat runs on every screen (incl. mid-call), so a
 * live call stays fresh inside the 90s window without a separate "on active call" clause.
 */
export function isKioskOnline(lastSeenAt: string | null, nowMs: number): boolean {
  if (!lastSeenAt) return false;
  const seen = Date.parse(lastSeenAt);
  if (Number.isNaN(seen)) return false;
  return nowMs - seen <= KIOSK_STALE_AFTER_MS;
}
