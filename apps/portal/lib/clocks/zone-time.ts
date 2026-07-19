// Pure wall-clock maths for the dashboard's world clocks (spec 3.7).
// No Date.now() in here -- the caller passes the instant, which is the only
// reason the DST transitions below are testable at all.

export type ZoneTime = {
  readonly hours: number;
  readonly minutes: number;
  readonly isNight: boolean;
};

/** Local hours before this are night. */
const DAY_STARTS_AT = 6;
/** Local hours from this on are night. */
const NIGHT_STARTS_AT = 18;

// Constructing an Intl.DateTimeFormat is the expensive part; the four faces
// re-render on a shared 20s tick, so build one per zone and keep it. The key
// set is the four zone constants, so this cannot grow unbounded.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      // hourCycle h23 rather than hour12:false. hour12 resolves per locale, and
      // some engines emit "24" for midnight under it -- today-window.ts:36 has
      // to defend against exactly that by hand. h23 states the intent directly.
      hourCycle: "h23",
      timeZone,
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function zoneTime(instant: Date, timeZone: string): ZoneTime {
  // formatToParts, not a split on the formatted string: the hour/minute
  // separator is locale-dependent (da-DK uses "." where en-GB uses ":").
  const parts = formatterFor(timeZone).formatToParts(instant);

  // The locale above is pinned to en-GB for its DIGITS, not its separator --
  // ar-EG, bn-IN and fa-IR all format the hour in non-latin numerals, which
  // Number() reads as NaN. Do not swap this for the viewer's locale.
  // hour and minute are always present because we asked for them; the fallback
  // exists only to satisfy the type.
  const read = (type: "hour" | "minute") =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const hours = read("hour");
  return {
    hours,
    minutes: read("minute"),
    isNight: hours < DAY_STARTS_AT || hours >= NIGHT_STARTS_AT,
  };
}

/**
 * Clock-face rotations in degrees, clockwise from twelve.
 *
 * Takes 24-hour input and wraps it, so a caller can hand `zoneTime` straight
 * through without converting: 15:00 and 03:00 point the same way.
 */
export function handAngles(
  hours: number,
  minutes: number,
): { readonly hour: number; readonly minute: number } {
  return {
    // The hour hand creeps: half a degree per minute, so it sits between the
    // hour marks rather than jumping between them.
    hour: (hours % 12) * 30 + minutes * 0.5,
    minute: minutes * 6,
  };
}
