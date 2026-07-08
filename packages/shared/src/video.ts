// LiveKit video-publish tuning (spec: docs/specs/2026-07-07-livekit-video-quality-tuning-design.md).
// The SINGLE source of the tunables so the portal + kiosk adapters can never drift.
// Retune here; both apps and the one test follow.
//
// Round 3 (2026-07-08): H.264, 1080p, 3.5 Mbps, single layer, "balanced" degradation.
// - Codec H.264 (NOT VP9): the hotel kiosk is an iPad, and iOS/WebKit reliably encodes
//   only H.264 — in HARDWARE (VideoToolbox). VP9 encode on Safari is experimental. The
//   soft Mac+Chrome staging test used SOFTWARE OpenH264; the real iPad uses hardware
//   H.264, much sharper at the same bitrate. (Validate on an actual iPad.)
// - Single layer: a 1:1 call has exactly one subscriber, so simulcast is pure uplink
//   overhead (and it forced Chrome into software H.264 — see round 2 in git history).
// - "balanced" degradation: under a constrained link the single stream steps RESOLUTION
//   down gracefully (1080 -> 720 -> 480 -> ...) instead of freezing framerate at 1080p.
// @lc/shared stays dependency-free (no livekit-client import); the builder needs no
// VideoPreset now that there are no simulcast layers to construct.

/** Tuning knobs. See the spec's decision table + the round-3 note above. */
export const LIVEKIT_VIDEO_TUNING = {
  videoCodec: "h264",
  /** The single published layer. */
  primary: { width: 1920, height: 1080, maxBitrate: 3_500_000, maxFramerate: 30 },
  degradationPreference: "balanced",
} as const;

export interface LiveKitVideoOptions {
  roomOptions: {
    videoCaptureDefaults: { resolution: { width: number; height: number } };
    publishDefaults: {
      videoCodec: "h264";
      videoEncoding: { maxBitrate: number; maxFramerate: number };
      simulcast: false;
      degradationPreference: "balanced";
    };
  };
  captureOptions: { resolution: { width: number; height: number } };
}

/**
 * Build the LiveKit Room + capture options from the shared tuning constant.
 * Both adapters call this, pass `roomOptions` to `new Room(...)`, and
 * `captureOptions` to `createLocalVideoTrack(...)`. Capture resolution is set
 * BOTH on the room defaults and returned as standalone `captureOptions` because
 * `createLocalVideoTrack` does not read the room's `videoCaptureDefaults`.
 */
export function buildLiveKitVideoOptions(): LiveKitVideoOptions {
  const { primary, videoCodec, degradationPreference } = LIVEKIT_VIDEO_TUNING;
  const resolution = { width: primary.width, height: primary.height };
  return {
    roomOptions: {
      videoCaptureDefaults: { resolution },
      publishDefaults: {
        videoCodec,
        videoEncoding: { maxBitrate: primary.maxBitrate, maxFramerate: primary.maxFramerate },
        simulcast: false,
        degradationPreference,
      },
    },
    captureOptions: { resolution },
  };
}
