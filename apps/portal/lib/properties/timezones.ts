// Curated IANA timezones offered when creating/editing a property. US-only for
// the v1 pilot. The validator restricts input to these values; the property
// form renders them as Select options. Single source of truth for both.

export type TimezoneOption = { value: string; label: string };

export const PROPERTY_TIMEZONES: ReadonlyArray<TimezoneOption> = [
  { value: "America/New_York", label: "Eastern (America/New_York)" },
  { value: "America/Chicago", label: "Central (America/Chicago)" },
  { value: "America/Denver", label: "Mountain (America/Denver)" },
  { value: "America/Phoenix", label: "Arizona (America/Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (America/Los_Angeles)" },
  { value: "America/Anchorage", label: "Alaska (America/Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Pacific/Honolulu)" },
];

export const TIMEZONE_VALUES: ReadonlyArray<string> = PROPERTY_TIMEZONES.map(
  (t) => t.value,
);

export const DEFAULT_TIMEZONE = "America/New_York";
