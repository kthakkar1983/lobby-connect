import { describe, it, expect } from "vitest";
import { buildLiveKitVideoOptions, LIVEKIT_VIDEO_TUNING } from "../src/video";

describe("buildLiveKitVideoOptions", () => {
  it("produces H.264 publish defaults at the tuned bitrate", () => {
    const { roomOptions } = buildLiveKitVideoOptions();
    expect(roomOptions.publishDefaults.videoCodec).toBe("h264");
    expect(roomOptions.publishDefaults.videoEncoding).toEqual({
      maxBitrate: 3_500_000,
      maxFramerate: 30,
    });
    expect(roomOptions.publishDefaults.degradationPreference).toBe("balanced");
  });

  it("publishes a single layer (simulcast disabled) — no simulcast layers", () => {
    const { roomOptions } = buildLiveKitVideoOptions();
    expect(roomOptions.publishDefaults.simulcast).toBe(false);
    expect(
      (roomOptions.publishDefaults as { videoSimulcastLayers?: unknown }).videoSimulcastLayers,
    ).toBeUndefined();
  });

  it("pins 1080p capture on both the room defaults and the standalone track options", () => {
    const { roomOptions, captureOptions } = buildLiveKitVideoOptions();
    expect(captureOptions.resolution).toEqual({ width: 1920, height: 1080 });
    expect(roomOptions.videoCaptureDefaults.resolution).toEqual({ width: 1920, height: 1080 });
  });

  it("keeps the tuning constant as the single retune point", () => {
    expect(LIVEKIT_VIDEO_TUNING.videoCodec).toBe("h264");
    expect(LIVEKIT_VIDEO_TUNING.primary.maxBitrate).toBe(3_500_000);
  });
});
