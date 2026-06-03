import * as Sentry from "@sentry/react";

const SENSITIVE_KEYS = new Set(["caller_number", "recording_url"]);
const PHONE_RE = /\+?\d[\d\s().-]{8,}\d/g;

function scrubPii(value: unknown): unknown {
  if (typeof value === "string") return value.replace(PHONE_RE, "[redacted]");
  if (Array.isArray(value)) return value.map(scrubPii);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k)) continue;
      out[k] = scrubPii(v);
    }
    return out;
  }
  return value;
}

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return; // no-op when unconfigured
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrubPii(event) as typeof event,
  });
}
