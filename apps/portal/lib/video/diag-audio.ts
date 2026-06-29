import * as Sentry from "@sentry/nextjs";

// TEMPORARY DIAGNOSTIC — remove once the "agent can't hear guest on the first
// call" cause is pinned. Probes the agent's playback of the guest's remote audio
// on a live call and reports ONE Sentry event, so the cause can be read without
// the agent ever opening DevTools. The decisive split:
//
//   maxVolume  > 0  (energy present) but the agent hears nothing
//       => the guest audio IS arriving + decoding; it's an OUTPUT / device-
//          routing problem on the agent's machine (not a publish/subscribe bug).
//   maxVolume == 0  for the whole window
//       => the guest audio never reached the agent => kiosk publish / connection.
//
// `autoplayFailed` tells us whether Agora reported the cold `<audio>.play()` as
// blocked (it plays remote audio through an HTMLAudioElement by default).
//
// Production-only (mirrors the Sentry init gate) so it never runs in tests or
// `next dev`, and never schedules a timer there.

interface VolumeSource {
  getVolumeLevel?: () => number;
}

const SAMPLE_INTERVAL_MS = 500;
const SAMPLE_COUNT = 12; // ~6s window

export function reportGuestAudioDiagnostics(
  track: VolumeSource | null | undefined,
  getAutoplayFailed: () => boolean,
  isCancelled: () => boolean,
): void {
  if (process.env.NODE_ENV !== "production") return;

  const samples: number[] = [];
  const id = setInterval(() => {
    if (isCancelled()) {
      clearInterval(id);
      return;
    }
    const v = track?.getVolumeLevel?.() ?? -1;
    samples.push(Number(v.toFixed(3)));
    if (samples.length >= SAMPLE_COUNT) {
      clearInterval(id);
      const maxVolume = samples.reduce((m, x) => Math.max(m, x), -1);
      // Bucket the verdict INTO the message so it's readable straight from the
      // Sentry issue list (stable grouping: energy x autoplayBlocked = 4 cases):
      //   energy=POSITIVE => guest audio decodes at the agent => OUTPUT/device.
      //   energy=ZERO     => guest audio never reached the agent => publish path.
      const energy = maxVolume > 0 ? "POSITIVE" : "ZERO";
      Sentry.captureMessage(
        `DIAG guest-audio: energy=${energy} autoplayBlocked=${getAutoplayFailed()}`,
        { level: "warning", extra: { maxVolume, samples } },
      );
    }
  }, SAMPLE_INTERVAL_MS);
}
