function localDateKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function isToday(iso: string, timeZone: string, now: Date): boolean {
  return localDateKey(iso, timeZone) === localDateKey(now.toISOString(), timeZone);
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
