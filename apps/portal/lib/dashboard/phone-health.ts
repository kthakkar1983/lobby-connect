import type { CallState } from "@lc/shared";

/**
 * Scale-aware phone-health rollup for the admin command center (spec §3.1).
 *
 * The single operator `health_signals.twilio_webhook` heartbeat only proves our whole
 * Twilio path is up; it cannot see a single failing hotel. So per-property "needs
 * attention" is derived from two signals the data already carries:
 *   - recent_failures: >= 1 FAILED call today (in the property's own timezone)
 *   - coverage_gap:    the property is accepting calls but its primary agent is not live
 * Staleness of the global heartbeat is computed by the caller (the status page owns the
 * timing threshold, per the Phase-4 single-source rule) and passed in as `heartbeat`.
 */

export type PhoneHealthProperty = {
  readonly id: string;
  readonly name: string;
  readonly timeZone: string;
  readonly accepting: boolean;
  readonly agentLive: boolean;
};

export type PhoneHealthCall = {
  readonly property_id: string;
  readonly state: CallState;
  readonly ring_started_at: string;
  readonly timeZone: string;
};

/** `null` = the heartbeat has never reported (treated as down). */
export type PhoneHealthHeartbeat = { readonly stale: boolean } | null;

export type PhoneHealthReason = "coverage_gap" | "recent_failures";

export type PhoneHealthAttention = {
  id: string;
  name: string;
  reasons: PhoneHealthReason[];
};

export type PhoneHealthRollupResult = {
  pathDown: boolean;
  ok: number;
  total: number;
  needAttention: PhoneHealthAttention[];
};

function isToday(iso: string, timeZone: string, now: Date): boolean {
  const key = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  return key(new Date(iso)) === key(now);
}

export function phoneHealthRollup(
  properties: ReadonlyArray<PhoneHealthProperty>,
  calls: ReadonlyArray<PhoneHealthCall>,
  heartbeat: PhoneHealthHeartbeat,
  now: Date,
): PhoneHealthRollupResult {
  const failedToday = new Set<string>();
  for (const c of calls) {
    if (c.state === "FAILED" && isToday(c.ring_started_at, c.timeZone, now)) {
      failedToday.add(c.property_id);
    }
  }

  const needAttention: PhoneHealthAttention[] = [];
  for (const p of properties) {
    const reasons: PhoneHealthReason[] = [];
    if (p.accepting && !p.agentLive) reasons.push("coverage_gap");
    if (failedToday.has(p.id)) reasons.push("recent_failures");
    if (reasons.length > 0) needAttention.push({ id: p.id, name: p.name, reasons });
  }

  return {
    pathDown: heartbeat == null || heartbeat.stale,
    total: properties.length,
    ok: properties.length - needAttention.length,
    needAttention,
  };
}
