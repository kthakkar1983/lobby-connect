// PII scrubber for Sentry. Wired as each app's `beforeSend`. Drops any key whose
// name looks sensitive (case-insensitive) plus the two known-sensitive keys,
// redacts phone-shaped runs from any free text (messages, breadcrumbs), and
// redacts Twilio recording URLs from any free text. The phone pattern requires a
// long run of digits + phone separators only, so it ignores real (hex) UUIDs and
// short numbers like room numbers.

const SENSITIVE_KEYS = new Set(["caller_number", "recording_url"]);
// `recording` catches Twilio param/column casings (RecordingUrl, recording_sid, …)
// beyond the exact `recording_url` key above.
const SENSITIVE_KEY_RE = /token|secret|auth|signature|password|cookie|recording/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key) || SENSITIVE_KEY_RE.test(key);
}

const PHONE_RE = /\+?\d[\d\s().-]{8,}\d/g;
// Twilio recording resource URLs (…/Recordings/RE…). Recording is OFF in v1, so
// `recording_url` is never written — but the call-detail recording seam and Twilio
// media URLs could surface one in a future error message or breadcrumb that isn't
// under a recording-named key. Redact the whole URL (run before PHONE_RE so the
// entire URL is dropped, not just digit runs inside it).
const RECORDING_URL_RE = /https?:\/\/\S*\/Recordings\/\S*/gi;

export function scrubPii(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(RECORDING_URL_RE, "[redacted]").replace(PHONE_RE, "[redacted]");
  }
  if (Array.isArray(value)) {
    return value.map(scrubPii);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) continue;
      out[k] = scrubPii(v);
    }
    return out;
  }
  return value;
}

// Unconstrained generic on purpose: Sentry's `Event` is an interface (no index
// signature), so a `Record<string, unknown>` constraint would reject it at the
// `beforeSend` call site. The scrub is purely structural, so `<T>(event: T): T`
// is the safe contract — it accepts any SDK's event shape and returns the same.
export function scrubEvent<T>(event: T): T {
  return scrubPii(event) as T;
}
