// PII scrubber for Sentry. Wired as each app's `beforeSend`. Drops any key whose
// name looks sensitive (case-insensitive) plus the two known-sensitive keys, and
// redacts phone-shaped runs from any free text (messages, breadcrumbs). The phone
// pattern requires a long run of digits + phone separators only, so it ignores
// real (hex) UUIDs and short numbers like room numbers.

const SENSITIVE_KEYS = new Set(["caller_number", "recording_url"]);
const SENSITIVE_KEY_RE = /token|secret|auth|signature|password|cookie/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key) || SENSITIVE_KEY_RE.test(key);
}

const PHONE_RE = /\+?\d[\d\s().-]{8,}\d/g;

export function scrubPii(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(PHONE_RE, "[redacted]");
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
