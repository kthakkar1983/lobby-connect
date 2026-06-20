import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry/scrub";
import { isTwilioTransportNoise } from "@/lib/sentry/noise";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Don't report from local `next dev` (NODE_ENV=development); only deployed builds.
  enabled: process.env.NODE_ENV === "production",
  tracesSampleRate: 0.1,
  // Drop the benign Twilio Voice transport-churn rejection; scrub PII from the rest.
  beforeSend: (event) => (isTwilioTransportNoise(event) ? null : scrubEvent(event)),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
