// LiveKit video-publish tuning (spec: docs/specs/2026-07-07-livekit-video-quality-tuning-design.md).
// The SINGLE source of the tunables so the portal + kiosk adapters can never
// drift. Retune here; both apps and the one test follow.
//
// Round 2 (2026-07-07, from staging webrtc-internals): SINGLE LAYER, no simulcast.
// This is a 1:1 call (exactly one subscriber), so simulcast buys nothing — it only
// splits the uplink AND forces Chrome into software H.264 (a HW encoder can't do
// H.264 simulcast). One layer puts the whole uplink into a single stream that BWE
// scales smoothly, and unlocks the hardware H.264 encoder. (The spec's pre-planned
// "single-layer H.264" branch.) @lc/shared stays dependency-free — no livekit-client
// import; the builder needs no VideoPreset now that there are no simulcast layers.

/** Tuning knobs. See the spec's decision table + the round-2 note above. */
export const LIVEKIT_VIDEO_TUNING = {
  videoCodec: "h264",
  /** The single published layer — the sharpness lever. */
  primary: { width: 1280, height: 720, maxBitrate: 2_500_000, maxFramerate: 30 },
  degradationPreference: "maintain-resolution",
} as const;

export interface LiveKitVideoOptions {
  roomOptions: {
    videoCaptureDefaults: { resolution: { width: number; height: number } };
    publishDefaults: {
      videoCodec: "h264";
      videoEncoding: { maxBitrate: number; maxFramerate: number };
      simulcast: false;
      degradationPreference: "maintain-resolution";
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
