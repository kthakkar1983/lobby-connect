import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry/scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  beforeSend: (event) => scrubEvent(event),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
