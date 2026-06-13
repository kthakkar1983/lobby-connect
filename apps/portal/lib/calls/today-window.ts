// UTC ISO instant for the start of "today" (local midnight) in the given tz.
// Used as a count-query lower bound so "calls today" is computed in Postgres
// instead of shipping rows to JS. Correct for US time zones (DST transitions at
// 02:00, never midnight); a hypothetical midnight-DST zone could be off by 1h.
export function startOfTodayUtc(tz: string, now: Date): string {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // "YYYY-MM-DD" local date in tz
  const parts = ymd.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0); // wall-clock midnight as if UTC
  const offsetMs = tzOffsetMs(new Date(guess), tz); // correct by the zone offset
  return new Date(guess - offsetMs).toISOString();
}

// Offset (ms) of tz from UTC at the given instant: format the instant as tz
// wall-clock, read it back as if it were UTC, subtract.
function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let hour = get("hour");
  if (hour === 24) hour = 0; // some engines emit "24" for midnight
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUtc - at.getTime();
}
