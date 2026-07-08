import { describe, it, expect } from "vitest";
import { buildLiveKitVideoOptions, LIVEKIT_VIDEO_TUNING } from "../src/video";

describe("buildLiveKitVideoOptions", () => {
  it("produces H.264 publish defaults at the tuned bitrate", () => {
    const { roomOptions } = buildLiveKitVideoOptions();
    expect(roomOptions.publishDefaults.videoCodec).toBe("h264");
    expect(roomOptions.publishDefaults.videoEncoding).toEqual({
      maxBitrate: 2_500_000,
      maxFramerate: 30,
    });
    expect(roomOptions.publishDefaults.degradationPreference).toBe("maintain-resolution");
  });

  it("publishes a single layer (simulcast disabled) — no simulcast layers", () => {
    const { roomOptions } = buildLiveKitVideoOptions();
    expect(roomOptions.publishDefaults.simulcast).toBe(false);
    expect(
      (roomOptions.publishDefaults as { videoSimulcastLayers?: unknown }).videoSimulcastLayers,
    ).toBeUndefined();
  });

  it("pins 720p capture on both the room defaults and the standalone track options", () => {
    const { roomOptions, captureOptions } = buildLiveKitVideoOptions();
    expect(captureOptions.resolution).toEqual({ width: 1280, height: 720 });
    expect(roomOptions.videoCaptureDefaults.resolution).toEqual({ width: 1280, height: 720 });
  });

  it("keeps the tuning constant as the single retune point", () => {
    expect(LIVEKIT_VIDEO_TUNING.videoCodec).toBe("h264");
    expect(LIVEKIT_VIDEO_TUNING.primary.maxBitrate).toBe(2_500_000);
  });
});
