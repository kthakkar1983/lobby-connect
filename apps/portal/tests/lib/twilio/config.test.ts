import { describe, it, expect, afterEach, vi } from "vitest";

import { getTwilioConfig } from "@/lib/twilio/config";
import { getTwilioApiCredentials } from "@/lib/twilio/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getTwilioConfig", () => {
  it("returns the three required values when all env vars are set", () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok123");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+15555550100");

    expect(getTwilioConfig()).toEqual({
      accountSid: "AC123",
      authToken: "tok123",
      phoneNumber: "+15555550100",
    });
  });

  it("throws when a required env var is missing", () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+15555550100");

    expect(() => getTwilioConfig()).toThrow(/Missing TWILIO_/);
  });
});

describe("getTwilioApiCredentials", () => {
  it("returns accountSid + API key sid/secret when all set", () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_API_KEY_SID", "SK123");
    vi.stubEnv("TWILIO_API_KEY_SECRET", "secret123");

    expect(getTwilioApiCredentials()).toEqual({
      accountSid: "AC123",
      apiKeySid: "SK123",
      apiKeySecret: "secret123",
    });
  });

  it("throws when an API key var is missing", () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_API_KEY_SID", "");
    vi.stubEnv("TWILIO_API_KEY_SECRET", "secret123");

    expect(() => getTwilioApiCredentials()).toThrow(/Missing TWILIO_API_KEY/);
  });
});
