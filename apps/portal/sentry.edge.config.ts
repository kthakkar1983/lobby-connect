import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry/scrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  beforeSend: (event) => scrubEvent(event),
});
