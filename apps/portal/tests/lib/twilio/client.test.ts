import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const validateRequest = vi.fn();

vi.mock("twilio", () => ({
  default: { validateRequest: (...args: unknown[]) => validateRequest(...args) },
}));

import { validateTwilioSignature, publicUrlFromRequest } from "@/lib/twilio/client";

beforeEach(() => {
  validateRequest.mockReset();
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "tok123");
  vi.stubEnv("TWILIO_PHONE_NUMBER", "+15555550100");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("validateTwilioSignature", () => {
  it("returns false immediately when the signature header is missing", () => {
    expect(validateTwilioSignature(null, "https://x.test/y", {})).toBe(false);
    expect(validateRequest).not.toHaveBeenCalled();
  });

  it("delegates to twilio.validateRequest with the auth token", () => {
    validateRequest.mockReturnValue(true);
    const ok = validateTwilioSignature("sig", "https://x.test/y", { To: "+1" });
    expect(ok).toBe(true);
    expect(validateRequest).toHaveBeenCalledWith(
      "tok123",
      "sig",
      "https://x.test/y",
      { To: "+1" },
    );
  });
});

describe("publicUrlFromRequest", () => {
  it("reconstructs the public URL from forwarded headers", () => {
    const req = new Request("http://localhost:3000/api/twilio/voice/incoming", {
      headers: {
        host: "abc.trycloudflare.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(publicUrlFromRequest(req)).toBe(
      "https://abc.trycloudflare.com/api/twilio/voice/incoming",
    );
  });
});
