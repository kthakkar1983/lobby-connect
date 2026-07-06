import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    await validateConfigAtBoot();
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * Fail-loud config check at server boot. The call-time readers
 * (getTwilioConfig / getLiveKitConfig / getKioskConfigSecret) stay untouched
 * for testability — here we just invoke them once so a missing or invalid var
 * surfaces a clear console.error naming it, instead of only blowing up on the
 * first call (mid voice/video flow). Best-effort: a thrown reader must not
 * crash boot, so each check is isolated.
 */
async function validateConfigAtBoot() {
  const { getTwilioConfig } = await import("./lib/twilio/config");
  const { getKioskConfigSecret } = await import("./lib/kiosk/config-secret");
  const { getLiveKitConfig } = await import("./lib/video/provider");

  const checks: Array<[string, () => unknown]> = [
    ["Twilio", getTwilioConfig],
    ["LiveKit", getLiveKitConfig],
    ["Kiosk config", getKioskConfigSecret],
    [
      "CRON_SECRET",
      () => {
        if (!process.env.CRON_SECRET) {
          throw new Error("Missing CRON_SECRET environment variable.");
        }
      },
    ],
  ];

  for (const [label, check] of checks) {
    try {
      check();
    } catch (err) {
      console.error(
        `[boot] ${label} config invalid:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

export const onRequestError = Sentry.captureRequestError;
