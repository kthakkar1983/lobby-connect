import { describe, it, expect, beforeEach, vi } from "vitest";
import { getVideoProvider, getLiveKitConfig } from "@/lib/video/provider";

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("getVideoProvider", () => {
  it("defaults to agora when unset (prod-inert merge, D8)", () => {
    vi.stubEnv("VIDEO_PROVIDER", "");
    expect(getVideoProvider()).toBe("agora");
  });
  it("returns livekit when set", () => {
    vi.stubEnv("VIDEO_PROVIDER", "livekit");
    expect(getVideoProvider()).toBe("livekit");
  });
  it("treats unknown values as agora (typo cannot dark-launch livekit)", () => {
    vi.stubEnv("VIDEO_PROVIDER", "liveKit");
    expect(getVideoProvider()).toBe("agora");
  });
});

describe("getLiveKitConfig", () => {
  it("returns url/key/secret when all present", () => {
    vi.stubEnv("LIVEKIT_URL", "wss://livekit.lobby-connect.com");
    vi.stubEnv("LIVEKIT_API_KEY", "lc_staging");
    vi.stubEnv("LIVEKIT_API_SECRET", "s".repeat(64));
    expect(getLiveKitConfig()).toEqual({
      url: "wss://livekit.lobby-connect.com",
      apiKey: "lc_staging",
      apiSecret: "s".repeat(64),
    });
  });
  it.each(["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const)(
    "throws naming the missing var: %s",
    (missing) => {
      vi.stubEnv("LIVEKIT_URL", "wss://x");
      vi.stubEnv("LIVEKIT_API_KEY", "k");
      vi.stubEnv("LIVEKIT_API_SECRET", "s");
      vi.stubEnv(missing, "");
      expect(() => getLiveKitConfig()).toThrow(missing);
    },
  );
});
