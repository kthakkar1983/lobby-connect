// Pure validation for admin-edited/added shift times (Task 20 of the
// shift-tracking plan). `now` is an explicit param (defaulting to `Date.now()`)
// so tests can pin the clock instead of racing it — mirrors the pattern in
// `lib/shifts/query.ts`'s `parseTimesheetRange(params, now = new Date())`.

/** A few minutes of allowance for client/server clock drift when checking
 *  "not in the future" — matches the spirit of the other clock-skew tolerances
 *  in this codebase (see `PRESENCE_STALE_AFTER_MS` neighbors in `protocol.ts`)
 *  without pulling in a shared constant for a single-purpose admin form. */
export const SHIFT_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Validate a shift's start/end instants for the admin edit/add forms.
 * Rules: both must parse as real instants; neither may be in the future
 * beyond a small clock-skew allowance; when an end is given, it must be
 * strictly after the start (a zero-length or negative shift is rejected).
 * `endedAtIso === null` means "still open" and is always valid on its own.
 */
export function validateShiftTimes(
  startedAtIso: string,
  endedAtIso: string | null,
  now: number = Date.now(),
): string | null {
  const startMs = Date.parse(startedAtIso);
  if (Number.isNaN(startMs)) return "Start time is invalid.";
  if (startMs > now + SHIFT_CLOCK_SKEW_MS) {
    return "Start time can't be in the future.";
  }

  if (endedAtIso === null) return null;

  const endMs = Date.parse(endedAtIso);
  if (Number.isNaN(endMs)) return "End time is invalid.";
  if (endMs > now + SHIFT_CLOCK_SKEW_MS) {
    return "End time can't be in the future.";
  }
  if (endMs <= startMs) return "End time must be after start time.";

  return null;
}
