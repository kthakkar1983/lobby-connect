// Admin timesheet: date-range parsing + per-shift metric assembly + the
// impure orchestrator that fetches shifts (RLS-scoped) plus the batched
// profiles/calls/audit context (service-role) and assembles one row per
// shift. Mirrors the 2-query actor-merge pattern in `admin/audit/page.tsx`.

import { PRESENCE_STALE_AFTER_MS, type ShiftEndedReason } from "@lc/shared";
import { computeClockedSeconds, computeUtilization } from "@/lib/shifts/lifecycle";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import type { createServerClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";

type Supa = Awaited<ReturnType<typeof createServerClient>>;
type Admin = ReturnType<typeof createAdminClient>;

// ---------------------------------------------------------------------------
// Range parsing
// ---------------------------------------------------------------------------

const DEFAULT_RANGE_DAYS = 7;

export type TimesheetRange = {
  readonly fromIso: string;
  readonly toIso: string;
  readonly label: string;
};

/** UTC midnight of the day `days` days before `now` (wall-clock subtract, then
 *  floor to that day). This is a fleet-wide report (no single property/timezone
 *  to anchor to), so the "start of day" boundary is UTC, not local. */
function startOfUtcDayDaysAgo(now: Date, days: number): string {
  const target = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate()),
  ).toISOString();
}

/** A `?from`/`?to` override must parse as a real instant; an unparseable value
 *  is ignored (falls back to the default) rather than rejecting the request —
 *  this is a read-only report page, not a mutation. */
function parseValidIso(raw: string | undefined): string | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** "Mon D" .. "Mon D, YYYY", both in UTC so the label is deterministic
 *  regardless of the server's local timezone. */
function formatRangeLabel(fromIso: string, toIso: string): string {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const short = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const withYear = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${short.format(from)} – ${withYear.format(to)}`;
}

/**
 * Resolve the admin timesheet's date range from query params, defaulting to
 * the last 7 days (UTC start-of-day .. now). `now` defaults to `new Date()`
 * but is an explicit param so callers (and tests) can pin the clock.
 */
export function parseTimesheetRange(
  params: { from?: string; to?: string },
  now: Date = new Date(),
): TimesheetRange {
  const toIso = parseValidIso(params.to) ?? now.toISOString();
  const fromIso = parseValidIso(params.from) ?? startOfUtcDayDaysAgo(now, DEFAULT_RANGE_DAYS);
  return { fromIso, toIso, label: formatRangeLabel(fromIso, toIso) };
}

// ---------------------------------------------------------------------------
// Shift windows + event bucketing
// ---------------------------------------------------------------------------

export type ShiftWindow = {
  readonly id: string;
  readonly userId: string;
  readonly startMs: number;
  readonly endMs: number;
};

/**
 * The shift's window upper bound (exclusive) for event attribution: `ended_at`
 * if closed, else the same "effective end" `computeClockedSeconds` (lifecycle.ts)
 * treats an open shift as ending at — the last heartbeat, if stale beyond
 * `PRESENCE_STALE_AFTER_MS`, else `now`. Deliberately mirrors that function's
 * branch rather than deriving an end instant from its rounded-seconds output
 * (which could drift the window boundary by up to 500ms). Kept as a small,
 * independent copy here since `lifecycle.ts` doesn't export the end instant
 * itself and this task's scope is `query.ts` only — worth consolidating into
 * lifecycle.ts if a future task touches both.
 */
export function shiftWindowEndMs(
  endedAtIso: string | null,
  lastSeenAtIso: string | null,
  nowMs: number,
): number {
  if (endedAtIso) return Date.parse(endedAtIso);
  const lastSeen = lastSeenAtIso ? Date.parse(lastSeenAtIso) : null;
  const stale = lastSeen === null || nowMs - lastSeen > PRESENCE_STALE_AFTER_MS;
  return stale && lastSeen !== null ? lastSeen : nowMs;
}

/** The shift (if any) whose `[start, end)` window contains this user's event. */
export function findShiftForEvent(
  windows: ReadonlyArray<ShiftWindow>,
  userId: string,
  atIso: string,
): string | null {
  const t = Date.parse(atIso);
  const match = windows.find((w) => w.userId === userId && t >= w.startMs && t < w.endMs);
  return match ? match.id : null;
}

export type TimestampedEvent = { readonly userId: string; readonly atIso: string };

/** Bucket events (calls, remote-access issuances) into the shift each falls
 *  within. An event outside every window for its user is dropped — it happened
 *  off-shift and has no shift to attribute to. */
export function bucketEventsByShift<T extends TimestampedEvent>(
  windows: ReadonlyArray<ShiftWindow>,
  events: ReadonlyArray<T>,
): Map<string, T[]> {
  const byShift = new Map<string, T[]>();
  for (const event of events) {
    const shiftId = findShiftForEvent(windows, event.userId, event.atIso);
    if (!shiftId) continue;
    const bucket = byShift.get(shiftId);
    if (bucket) bucket.push(event);
    else byShift.set(shiftId, [event]);
  }
  return byShift;
}

// ---------------------------------------------------------------------------
// Row assembly (pure)
// ---------------------------------------------------------------------------

export type ShiftForAssembly = {
  readonly id: string;
  readonly user_id: string;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly ended_reason: ShiftEndedReason | null;
};

export type CallForAssembly = { readonly duration_seconds: number | null };

export type ProfileForAssembly = {
  readonly full_name: string;
  readonly role: string;
  readonly last_seen_at: string | null;
};

export type ShiftTimesheetRow = {
  readonly userId: string;
  readonly name: string;
  readonly role: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly endedReason: ShiftEndedReason | null;
  readonly clockedSeconds: number;
  readonly callCount: number;
  readonly talkSeconds: number;
  readonly remoteCount: number;
  readonly utilization: number;
};

/**
 * Pure metric assembly for one timesheet row. `calls` must already be the
 * subset attributed to this shift's window (see `bucketEventsByShift`) —
 * this function only sums/derives from what it's given, it doesn't filter.
 * `profile` is null only if the batched profile fetch missed the row (should
 * not happen in practice — a profile with shift history can't be hard-deleted,
 * the FK is ON DELETE RESTRICT — but this is a display page, so degrade to a
 * placeholder rather than throw).
 */
export function assembleShiftRow(
  shift: ShiftForAssembly,
  calls: ReadonlyArray<CallForAssembly>,
  remoteCount: number,
  profile: ProfileForAssembly | null,
  nowMs: number,
): ShiftTimesheetRow {
  const clockedSeconds = computeClockedSeconds(
    shift.started_at,
    shift.ended_at,
    profile?.last_seen_at ?? null,
    nowMs,
  );
  const talkSeconds = calls.reduce((sum, c) => sum + (c.duration_seconds ?? 0), 0);
  return {
    userId: shift.user_id,
    name: profile?.full_name ?? "Unknown",
    role: profile?.role ?? "",
    startedAt: shift.started_at,
    endedAt: shift.ended_at,
    endedReason: shift.ended_reason,
    clockedSeconds,
    callCount: calls.length,
    talkSeconds,
    remoteCount,
    utilization: computeUtilization(clockedSeconds, talkSeconds),
  };
}

// ---------------------------------------------------------------------------
// Orchestrator (impure)
// ---------------------------------------------------------------------------

type ShiftRow = {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  ended_reason: ShiftEndedReason | null;
};

type ProfileRow = {
  id: string;
  full_name: string;
  role: string;
  last_seen_at: string | null;
};

type CallRow = {
  handled_by_user_id: string | null;
  answered_at: string | null;
  duration_seconds: number | null;
};

type AuditRow = {
  actor_user_id: string | null;
  created_at: string;
  details: { trigger?: string } | null;
};

/**
 * Fetch the operator's shifts in `range` (RLS-scoped via `supabase` — the
 * admin SELECT policy from migration 0021) plus the batched profiles/calls/
 * audit context (service-role `admin`, since a plain admin's own RLS doesn't
 * necessarily cover every other agent's calls/audit rows), then assemble one
 * row per shift using the pure helpers above. Mirrors the 2-query
 * actor-merge pattern in `admin/audit/page.tsx`.
 *
 * Query-shape notes (not exercised against a live Supabase project in this
 * task's environment — flagging for review):
 * - Shifts are filtered on `started_at` within `[from, to]`. A shift that
 *   started just before `from` but ran into the range would be excluded —
 *   acceptable for a fleet timesheet report (not exact interval-overlap
 *   semantics), but worth confirming against a real multi-day dataset.
 * - "Talk time" counts only `state = 'COMPLETED'` calls (the one terminal
 *   state with a meaningful `duration_seconds`; NO_ANSWER/FAILED have none).
 * - "Remote" counts only REAL remote sessions: `remote_access.credentials_issued`
 *   rows with `details.trigger = "connect"` (an actual Connect press). The other
 *   trigger, "prewarm", fires automatically on every answered call as a
 *   credential cache-warm — NOT a remote-desktop session — so counting prewarms
 *   would make "remote sessions" ≈ call count and useless as a work signal.
 *   Cache hits emit no audit row, so connect-rows = distinct real sessions she
 *   started. Filtered both in PostgREST (`.eq("details->>trigger", "connect")`,
 *   JSONB text extraction) for efficiency AND client-side as a robustness guard
 *   (a null/absent `details.trigger` never counts).
 */
export async function fetchTimesheet(
  supabase: Supa,
  admin: Admin,
  operatorId: string,
  range: TimesheetRange,
): Promise<ShiftTimesheetRow[]> {
  const { data: shiftData, error: shiftsError } = await supabase
    .from("shifts")
    .select("id, user_id, started_at, ended_at, ended_reason")
    .eq("operator_id", operatorId)
    .gte("started_at", range.fromIso)
    .lte("started_at", range.toIso)
    .order("started_at", { ascending: false });
  if (shiftsError) {
    console.error("[shifts] fetchTimesheet: shifts read failed", shiftsError);
  }
  const shifts = (shiftData ?? []) as ShiftRow[];
  if (shifts.length === 0) return [];

  const userIds = [...new Set(shifts.map((s) => s.user_id))];
  const nowMs = Date.now();

  const [profilesResult, callsResult, auditResult] = await Promise.all([
    admin.from("profiles").select("id, full_name, role, last_seen_at").in("id", userIds),
    admin
      .from("calls")
      .select("handled_by_user_id, answered_at, duration_seconds")
      .eq("operator_id", operatorId)
      .eq("state", "COMPLETED")
      .in("handled_by_user_id", userIds)
      .gte("answered_at", range.fromIso)
      .lte("answered_at", range.toIso),
    admin
      .from("audit_logs")
      .select("actor_user_id, created_at, details")
      .eq("operator_id", operatorId)
      .eq("action", AUDIT_ACTIONS.REMOTE_ACCESS_CREDENTIALS_ISSUED)
      .eq("details->>trigger", "connect")
      .in("actor_user_id", userIds)
      .gte("created_at", range.fromIso)
      .lte("created_at", range.toIso),
  ]);

  if (profilesResult.error) {
    console.error("[shifts] fetchTimesheet: profiles read failed", profilesResult.error);
  }
  if (callsResult.error) {
    console.error("[shifts] fetchTimesheet: calls read failed", callsResult.error);
  }
  if (auditResult.error) {
    console.error("[shifts] fetchTimesheet: audit read failed", auditResult.error);
  }

  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const calls = (callsResult.data ?? []) as CallRow[];
  const auditRows = (auditResult.data ?? []) as AuditRow[];

  const profileById = new Map(profiles.map((p) => [p.id, p]));

  const windows: ShiftWindow[] = shifts.map((s) => ({
    id: s.id,
    userId: s.user_id,
    startMs: Date.parse(s.started_at),
    endMs: shiftWindowEndMs(s.ended_at, profileById.get(s.user_id)?.last_seen_at ?? null, nowMs),
  }));

  const callEvents = calls
    .filter(
      (c): c is CallRow & { handled_by_user_id: string; answered_at: string } =>
        !!c.handled_by_user_id && !!c.answered_at,
    )
    .map((c) => ({
      userId: c.handled_by_user_id,
      atIso: c.answered_at,
      duration_seconds: c.duration_seconds,
    }));
  const callsByShift = bucketEventsByShift(windows, callEvents);

  const remoteEvents = auditRows
    // The PostgREST `details->>trigger=connect` filter already scopes this, but
    // re-apply client-side so a prewarm (or a null/absent trigger) can never be
    // counted as a real remote session even if the DB filter were relaxed.
    .filter(
      (a): a is AuditRow & { actor_user_id: string } =>
        !!a.actor_user_id && a.details?.trigger === "connect",
    )
    .map((a) => ({ userId: a.actor_user_id, atIso: a.created_at }));
  const remoteByShift = bucketEventsByShift(windows, remoteEvents);

  return shifts.map((s) =>
    assembleShiftRow(
      s,
      callsByShift.get(s.id) ?? [],
      (remoteByShift.get(s.id) ?? []).length,
      profileById.get(s.user_id) ?? null,
      nowMs,
    ),
  );
}
