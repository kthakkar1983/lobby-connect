// LiveKit video-publish tuning (spec: docs/specs/2026-07-07-livekit-video-quality-tuning-design.md).
// The SINGLE source of the tunables so the portal + kiosk adapters can never
// drift. Round-1 spike values — retune here; both apps and the one test follow.
//
// @lc/shared stays dependency-free (mirrors protocol.ts): the livekit-client
// VideoPreset class is dependency-INJECTED by each adapter, never imported here.

/** Round-1 tuning knobs. See the spec's decision table for rationale. */
export const LIVEKIT_VIDEO_TUNING = {
  videoCodec: "h264",
  /** Primary (top) simulcast layer — the sharpness lever. */
  primary: { width: 1280, height: 720, maxBitrate: 2_500_000, maxFramerate: 30 },
  /** The single lower fallback rung (2 total layers) — standard h360. */
  lower: { width: 640, height: 360, maxBitrate: 450_000, maxFramerate: 20 },
  degradationPreference: "maintain-resolution",
} as const;

/** Ctor shape of livekit-client's VideoPreset, injected to keep this package livekit-free. */
type VideoPresetCtor<T> = new (
  width: number,
  height: number,
  maxBitrate: number,
  maxFramerate: number,
) => T;

export interface LiveKitVideoOptions<TPreset> {
  roomOptions: {
    videoCaptureDefaults: { resolution: { width: number; height: number } };
    publishDefaults: {
      videoCodec: "h264";
      videoEncoding: { maxBitrate: number; maxFramerate: number };
      simulcast: true;
      videoSimulcastLayers: TPreset[];
      degradationPreference: "maintain-resolution";
    };
  };
  captureOptions: { resolution: { width: number; height: number } };
}

/**
 * Build the LiveKit Room + capture options from the shared tuning constant.
 * `VideoPreset` is the livekit-client class (injected). Both adapters call this,
 * pass `roomOptions` to `new Room(...)`, and `captureOptions` to
 * `createLocalVideoTrack(...)`. Capture resolution is set BOTH on the room
 * defaults and returned as standalone `captureOptions` because
 * `createLocalVideoTrack` does not read the room's `videoCaptureDefaults`.
 */
export function buildLiveKitVideoOptions<TPreset>(
  VideoPreset: VideoPresetCtor<TPreset>,
): LiveKitVideoOptions<TPreset> {
  const { primary, lower, videoCodec, degradationPreference } = LIVEKIT_VIDEO_TUNING;
  const resolution = { width: primary.width, height: primary.height };
  return {
    roomOptions: {
      videoCaptureDefaults: { resolution },
      publishDefaults: {
        videoCodec,
        videoEncoding: { maxBitrate: primary.maxBitrate, maxFramerate: primary.maxFramerate },
        simulcast: true,
        videoSimulcastLayers: [
          new VideoPreset(lower.width, lower.height, lower.maxBitrate, lower.maxFramerate),
        ],
        degradationPreference,
      },
    },
    captureOptions: { resolution },
  };
}
