import * as Sentry from "@sentry/react";
import { scrubPii } from "@lc/shared";

export { scrubPii };

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return; // no-op when unconfigured
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrubPii(event) as typeof event,
  });
}
