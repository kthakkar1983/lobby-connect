import { describe, it, expect, afterEach, vi } from "vitest";
import { buildRtcPublisherToken } from "@/lib/agora/token";
import { getAgoraCredentials } from "@/lib/agora/config";

// A valid-length 32-hex App Certificate (fake, for shape only).
const APP_ID = "a".repeat(32);
const CERT = "b".repeat(32);

describe("buildRtcPublisherToken", () => {
  it("returns a non-empty Agora token string (version-prefixed)", () => {
    const token = buildRtcPublisherToken({
      appId: APP_ID,
      appCertificate: CERT,
      channelName: "call_123",
      uid: 4242,
      expireSeconds: 3600,
    });
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);
    expect(token.startsWith("007")).toBe(true); // Agora AccessToken2 version prefix
  });
});

describe("getAgoraCredentials", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("throws when env is missing", () => {
    vi.stubEnv("AGORA_APP_ID", "");
    vi.stubEnv("AGORA_APP_CERTIFICATE", "");
    expect(() => getAgoraCredentials()).toThrow(/AGORA_APP_ID/);
  });

  it("returns both when set", () => {
    vi.stubEnv("AGORA_APP_ID", APP_ID);
    vi.stubEnv("AGORA_APP_CERTIFICATE", CERT);
    expect(getAgoraCredentials()).toEqual({ appId: APP_ID, appCertificate: CERT });
  });
});
