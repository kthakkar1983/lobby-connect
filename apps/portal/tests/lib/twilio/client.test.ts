import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextResponse } from "next/server";

const validateRequest = vi.fn();

vi.mock("twilio", () => ({
  default: { validateRequest: (...args: unknown[]) => validateRequest(...args) },
}));

import {
  validateTwilioSignature,
  publicUrlFromRequest,
  parseVerifiedTwilioWebhook,
} from "@/lib/twilio/client";

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

describe("parseVerifiedTwilioWebhook", () => {
  function makeRequest(
    body: string,
    signature: string | null,
  ): Request {
    const headers: Record<string, string> = {
      host: "example.vercel.app",
      "x-forwarded-proto": "https",
      "content-type": "application/x-www-form-urlencoded",
    };
    if (signature !== null) headers["x-twilio-signature"] = signature;
    return new Request(
      "https://example.vercel.app/api/twilio/voice/incoming",
      { method: "POST", headers, body },
    );
  }

  it("returns parsed params when signature is valid", async () => {
    validateRequest.mockReturnValue(true);
    const req = makeRequest("CallSid=CA123&From=%2B15550001111", "good-sig");
    const result = await parseVerifiedTwilioWebhook(req);
    expect(result).not.toBeInstanceOf(NextResponse);
    expect((result as { params: Record<string, string> }).params).toEqual({
      CallSid: "CA123",
      From: "+15550001111",
    });
  });

  it("returns a 403 NextResponse when signature is invalid", async () => {
    validateRequest.mockReturnValue(false);
    const req = makeRequest("CallSid=CA999", "bad-sig");
    const result = await parseVerifiedTwilioWebhook(req);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it("returns a 403 NextResponse when x-twilio-signature header is missing", async () => {
    const req = makeRequest("CallSid=CA000", null);
    const result = await parseVerifiedTwilioWebhook(req);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
    // validateRequest not called when signature is null
    expect(validateRequest).not.toHaveBeenCalled();
  });
});
