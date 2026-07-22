import type { CallState, CallChannel, CallDirection } from "@lc/shared";

function localDateKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** True when `iso`'s calendar date, in `timeZone`, matches `now`'s calendar date in that same zone. */
export function isTodayInZone(iso: string, timeZone: string, now: Date): boolean {
  return localDateKey(iso, timeZone) === localDateKey(now.toISOString(), timeZone);
}

function isToday(iso: string, timeZone: string, now: Date): boolean {
  return isTodayInZone(iso, timeZone, now);
}

function localHour(iso: string, timeZone: string): number {
  const h = Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hour12: false }).format(new Date(iso)),
  );
  return h === 24 ? 0 : h; // some engines emit "24" for midnight
}

export type DatedCall = { readonly ring_started_at: string; readonly timeZone: string };

export function countToday(items: ReadonlyArray<DatedCall>, now: Date): number {
  return items.filter((c) => isToday(c.ring_started_at, c.timeZone, now)).length;
}

export type PickupCall = DatedCall & { readonly answered_at: string | null };

export function avgPickupSeconds(items: ReadonlyArray<PickupCall>, now: Date): number | null {
  const today = items.filter(
    (c) => c.answered_at != null && isToday(c.ring_started_at, c.timeZone, now),
  );
  if (today.length === 0) return null;
  const total = today.reduce(
    (sum, c) => sum + (Date.parse(c.answered_at as string) - Date.parse(c.ring_started_at)) / 1000,
    0,
  );
  return Math.round(total / today.length);
}

export type DurationCall = DatedCall & { readonly duration_seconds: number | null };

export function sumTodayDurationSeconds(items: ReadonlyArray<DurationCall>, now: Date): number {
  return items
    .filter((c) => isToday(c.ring_started_at, c.timeZone, now))
    .reduce((sum, c) => sum + (c.duration_seconds ?? 0), 0);
}

export type AnsweredDurationCall = DatedCall & {
  readonly answered_at: string | null;
  readonly duration_seconds: number | null;
};

/** Mean length of today's *answered* calls that have a recorded duration. */
export function avgCallLengthSeconds(items: ReadonlyArray<AnsweredDurationCall>, now: Date): number | null {
  const qualifying = items.filter(
    (c) =>
      c.answered_at != null &&
      c.duration_seconds != null &&
      isToday(c.ring_started_at, c.timeZone, now),
  );
  if (qualifying.length === 0) return null;
  const total = qualifying.reduce((sum, c) => sum + (c.duration_seconds as number), 0);
  return Math.round(total / qualifying.length);
}

export type OutcomeCall = DatedCall & { readonly state: CallState; readonly direction?: CallDirection };
export type OutcomeCounts = { answered: number; missed: number; failed: number };

/**
 * Today's calls bucketed by terminal state. Live states (RINGING/IN_PROGRESS) are not outcomes.
 * An OUTBOUND NO_ANSWER (agent-placed call-back the guest didn't pick up) is not a "missed"
 * guest call, so it's excluded from `missed`. `direction` defaults to INBOUND (omitted ==
 * INBOUND) so every existing caller stays byte-identical.
 */
export function countByOutcome(items: ReadonlyArray<OutcomeCall>, now: Date): OutcomeCounts {
  const counts: OutcomeCounts = { answered: 0, missed: 0, failed: 0 };
  for (const c of items) {
    if (!isToday(c.ring_started_at, c.timeZone, now)) continue;
    if (c.state === "COMPLETED") counts.answered++;
    else if (c.state === "NO_ANSWER" && c.direction !== "OUTBOUND") counts.missed++;
    else if (c.state === "FAILED") counts.failed++;
  }
  return counts;
}

/**
 * Dot color for a call's outcome (used as the channel-icon-adjacent status dot on
 * dashboard/owner call rows). Mirrors `callPill`'s direction-awareness: an OUTBOUND
 * NO_ANSWER is not a "missed" guest call, so it gets a quiet dot instead of the
 * attention/blaze one. `direction` defaults to INBOUND, preserving the original
 * mapping byte-for-byte for every existing caller.
 */
export function outcomeDotClass(state: CallState, direction: CallDirection = "INBOUND"): string {
  if (state === "NO_ANSWER" && direction === "OUTBOUND") return "bg-muted-foreground/40";
  if (state === "COMPLETED") return "bg-live"; // answered
  if (state === "NO_ANSWER") return "bg-attention"; // missed
  if (state === "FAILED") return "bg-muted-foreground"; // system failure
  return "bg-live"; // RINGING / IN_PROGRESS — still live
}

export type ChannelCall = { readonly channel: CallChannel };
export type ChannelCounts = { audio: number; video: number };

/** Splits the given calls by channel. Caller decides the set (e.g. today, a property). */
export function splitByChannel(items: ReadonlyArray<ChannelCall>): ChannelCounts {
  const counts: ChannelCounts = { audio: 0, video: 0 };
  for (const c of items) {
    if (c.channel === "AUDIO") counts.audio++;
    else if (c.channel === "VIDEO") counts.video++;
  }
  return counts;
}

export type DatedChannelCall = DatedCall & { readonly channel: CallChannel };
export type HourlyCall = DatedChannelCall & { readonly state: CallState; readonly direction?: CallDirection };
export type HourBucket = { hour: number; audio: number; video: number; missed: number };

/**
 * Today's calls bucketed by the local hour (0-23) of `ring_started_at`, partitioned into
 * three disjoint outcome series for the grouped hourly chart:
 *   - audio  = answered phone calls (COMPLETED + AUDIO)
 *   - video  = answered video calls (COMPLETED + VIDEO)
 *   - missed = unanswered INBOUND calls (NO_ANSWER, either channel); an OUTBOUND NO_ANSWER
 *     (agent-placed call-back the guest didn't pick up) is excluded — not a "missed" guest call
 * FAILED (a system error, surfaced under Calls › Failed) and still-live calls are excluded, so a
 * missed call is counted once in `missed` — never double-counted in its channel. Each call is
 * bucketed in its own property timezone ("volume by hotel-local hour"). Always 24 buckets.
 * `direction` defaults to INBOUND (omitted == INBOUND) so every existing caller is unaffected.
 */
export function hourlyVolume(items: ReadonlyArray<HourlyCall>, now: Date): HourBucket[] {
  const buckets: HourBucket[] = Array.from({ length: 24 }, (_, hour) => ({ hour, audio: 0, video: 0, missed: 0 }));
  for (const c of items) {
    if (!isToday(c.ring_started_at, c.timeZone, now)) continue;
    const bucket = buckets[localHour(c.ring_started_at, c.timeZone)];
    if (!bucket) continue; // unreachable: localHour is always 0-23
    if (c.state === "NO_ANSWER" && c.direction !== "OUTBOUND") bucket.missed++;
    else if (c.state === "COMPLETED" && c.channel === "AUDIO") bucket.audio++;
    else if (c.state === "COMPLETED" && c.channel === "VIDEO") bucket.video++;
  }
  return buckets;
}

/** Today's calls split by channel (all states) — drives the per-property pod / board bars. */
export function splitTodayByChannel(items: ReadonlyArray<DatedChannelCall>, now: Date): ChannelCounts {
  return splitByChannel(items.filter((c) => isToday(c.ring_started_at, c.timeZone, now)));
}

export type LiveCall = { readonly state: CallState; readonly channel: CallChannel };
export type LiveCounts = { total: number; audio: number; video: number };

/** Calls live right now (RINGING or IN_PROGRESS), split by channel. Not time-filtered. */
export function countLiveCalls(items: ReadonlyArray<LiveCall>): LiveCounts {
  const counts: LiveCounts = { total: 0, audio: 0, video: 0 };
  for (const c of items) {
    if (c.state !== "RINGING" && c.state !== "IN_PROGRESS") continue;
    counts.total++;
    if (c.channel === "AUDIO") counts.audio++;
    else if (c.channel === "VIDEO") counts.video++;
  }
  return counts;
}
