import type { IncidentStatus } from "@lc/shared";

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
