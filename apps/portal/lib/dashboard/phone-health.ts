import type { CallState } from "@lc/shared";

/**
 * Per-property phone-health rollup for the admin command center (spec §3.1).
 *
 * "Needs attention" fires only on a CONCRETE failure: >= 1 FAILED call today (a real
 * Twilio/path error), in the property's own timezone. FAILED is unambiguous, post-hoc,
 * and window-independent, so the tile never false-alarms.
 *
 * v2 refinements (deliberately NOT done here):
 *   - coverage_gap: an earlier version flagged "Covering ON but primary agent offline",
 *     but that IS the normal after-hours setup (an admin covering for an off agent), so
 *     it false-alarmed. Doing it right needs covered-window awareness + operator-wide
 *     admin availability/presence (we only have one admin's toggle), so it's deferred.
 *   - path_down (red): the only global signal (`twilio_webhook`) is info-mode (a quiet
 *     pilot has no calls → can't tell "down" from "quiet"); needs a real outage probe.
 */

export type PhoneHealthProperty = {
  readonly id: string;
  readonly name: string;
  readonly timeZone: string;
};

export type PhoneHealthCall = {
  readonly property_id: string;
  readonly state: CallState;
  readonly ring_started_at: string;
  readonly timeZone: string;
};

export type PhoneHealthReason = "recent_failures";

export type PhoneHealthAttention = {
  id: string;
  name: string;
  reasons: PhoneHealthReason[];
};

export type PhoneHealthRollupResult = {
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
  now: Date,
): PhoneHealthRollupResult {
  const failedToday = new Set<string>();
  for (const c of calls) {
    if (c.state === "FAILED" && isToday(c.ring_started_at, c.timeZone, now)) {
      failedToday.add(c.property_id);
    }
  }

  const needAttention: PhoneHealthAttention[] = properties
    .filter((p) => failedToday.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, reasons: ["recent_failures"] }));

  return {
    total: properties.length,
    ok: properties.length - needAttention.length,
    needAttention,
  };
}
