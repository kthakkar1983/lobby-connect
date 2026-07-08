import { describe, it, expect } from "vitest";
import { buildLiveKitVideoOptions, LIVEKIT_VIDEO_TUNING } from "../src/video";

// Minimal stand-in for livekit-client's VideoPreset (records ctor args).
class StubVideoPreset {
  constructor(
    public width: number,
    public height: number,
    public maxBitrate: number,
    public maxFramerate: number,
  ) {}
}

describe("buildLiveKitVideoOptions", () => {
  it("produces H.264 publish defaults at the tuned bitrate", () => {
    const { roomOptions } = buildLiveKitVideoOptions(StubVideoPreset);
    expect(roomOptions.publishDefaults.videoCodec).toBe("h264");
    expect(roomOptions.publishDefaults.videoEncoding).toEqual({
      maxBitrate: 2_500_000,
      maxFramerate: 30,
    });
    expect(roomOptions.publishDefaults.degradationPreference).toBe("maintain-resolution");
    expect(roomOptions.publishDefaults.simulcast).toBe(true);
  });

  it("emits exactly one lower simulcast layer (2 total) at h360", () => {
    const { roomOptions } = buildLiveKitVideoOptions(StubVideoPreset);
    const layers = roomOptions.publishDefaults.videoSimulcastLayers as StubVideoPreset[];
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({
      width: 640,
      height: 360,
      maxBitrate: 450_000,
      maxFramerate: 20,
    });
  });

  it("pins 720p capture on both the room defaults and the standalone track options", () => {
    const { roomOptions, captureOptions } = buildLiveKitVideoOptions(StubVideoPreset);
    expect(captureOptions.resolution).toEqual({ width: 1280, height: 720 });
    expect(roomOptions.videoCaptureDefaults.resolution).toEqual({ width: 1280, height: 720 });
  });

  it("keeps the tuning constant as the single retune point", () => {
    expect(LIVEKIT_VIDEO_TUNING.videoCodec).toBe("h264");
    expect(LIVEKIT_VIDEO_TUNING.primary.maxBitrate).toBe(2_500_000);
  });
});
