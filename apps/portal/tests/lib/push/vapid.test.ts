import { afterEach, describe, expect, it, vi } from "vitest";

describe("getVapidConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns the three VAPID values when set", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "pub-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv-key");
    vi.stubEnv("VAPID_SUBJECT", "mailto:ops@example.com");
    const { getVapidConfig } = await import("@/lib/push/vapid");
    expect(getVapidConfig()).toEqual({
      publicKey: "pub-key",
      privateKey: "priv-key",
      subject: "mailto:ops@example.com",
    });
  });

  it("throws a named error when a value is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "pub-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    vi.stubEnv("VAPID_SUBJECT", "mailto:ops@example.com");
    const { getVapidConfig } = await import("@/lib/push/vapid");
    expect(() => getVapidConfig()).toThrow(/VAPID_PRIVATE_KEY/);
  });
});
