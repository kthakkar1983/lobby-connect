import type { IncidentStatus } from "@lc/shared";
import { formatTimeOnly } from "./format";

// "YYYY-MM-DD" for the given instant in the given timezone (en-CA → ISO order).
function localDateKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function isToday(iso: string, timeZone: string, now: Date): boolean {
  return localDateKey(iso, timeZone) === localDateKey(now.toISOString(), timeZone);
}

export function countTodayCalls(
  calls: ReadonlyArray<{ ring_started_at: string }>,
  timeZone: string,
  now: Date,
): number {
  return calls.filter((c) => isToday(c.ring_started_at, timeZone, now)).length;
}

export function isOpenIncident(status: IncidentStatus): boolean {
  return status !== "RESOLVED";
}

export function countOpenIncidents(
  incidents: ReadonlyArray<{ status: IncidentStatus }>,
): number {
  return incidents.filter((i) => isOpenIncident(i.status)).length;
}

/** "Today" / "Yesterday" / "Mon D" for an instant in tz, relative to now. */
export function dayGroupLabel(iso: string, timeZone: string, now: Date): string {
  const key = localDateKey(iso, timeZone);
  const todayKey = localDateKey(now.toISOString(), timeZone);
  const yesterdayKey = localDateKey(
    new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    timeZone,
  );
  if (key === todayKey) return "Today";
  if (key === yesterdayKey) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(
    new Date(iso),
  );
}

/** Latest call's time-of-day (tz) from rows, or null when empty. */
export function latestCallTime(
  calls: ReadonlyArray<{ ring_started_at: string }>,
  timeZone: string,
): string | null {
  if (calls.length === 0) return null;
  const latest = calls.reduce((a, b) => (a.ring_started_at > b.ring_started_at ? a : b));
  return formatTimeOnly(latest.ring_started_at, timeZone);
}
