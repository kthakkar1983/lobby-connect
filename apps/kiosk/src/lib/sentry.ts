import * as Sentry from "@sentry/react";
import { scrubPii } from "@lc/shared";

export { scrubPii };

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  // no-op when unconfigured, or when running the local Vite dev server
  if (!dsn || import.meta.env.DEV) return;
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrubPii(event) as typeof event,
  });
}
