import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry/scrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Don't report from local `next dev` (NODE_ENV=development); only deployed builds.
  enabled: process.env.NODE_ENV === "production",
  tracesSampleRate: 0.1,
  beforeSend: (event) => scrubEvent(event),
});
