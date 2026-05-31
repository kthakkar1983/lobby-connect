import { describe, it, expect, beforeEach, vi } from "vitest";

const validateTwilioSignature = vi.fn();
const publicUrlFromRequest = vi.fn(
  () => "https://abc.trycloudflare.com/api/twilio/voice/dial-result",
);
vi.mock("@/lib/twilio/client", () => ({
  validateTwilioSignature: (...a: unknown[]) => validateTwilioSignature(...a),
  publicUrlFromRequest: (...a: unknown[]) => publicUrlFromRequest(...a),
}));

const updateSpy = vi.fn(() => Promise.resolve({ error: null }));
function makeAdminClient() {
  return {
    from() {
      const builder: Record<string, unknown> = {};
      builder.update = (vals: unknown) => {
        updateSpy(vals);
        return builder;
      };
      builder.eq = () => builder;
      builder.then = (resolve: (v: unknown) => void) => resolve({ error: null });
      return builder;
    },
  };
}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminClient(),
}));

import { POST } from "@/app/api/twilio/voice/dial-result/route";

function makeRequest(params: Record<string, string>) {
  return new Request("http://localhost:3000/api/twilio/voice/dial-result", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": "sig",
    },
    body: new URLSearchParams(params),
  });
}

beforeEach(() => {
  updateSpy.mockClear();
  validateTwilioSignature.mockReturnValue(true);
});

describe("POST /api/twilio/voice/dial-result", () => {
  it("rejects an invalid signature with 403", async () => {
    validateTwilioSignature.mockReturnValue(false);
    const res = await POST(makeRequest({ CallSid: "CA1", DialCallStatus: "completed" }));
    expect(res.status).toBe(403);
  });

  it("answered call → Hangup + COMPLETED", async () => {
    const res = await POST(
      makeRequest({ CallSid: "CA1", DialCallStatus: "completed" }),
    );
    const xml = await res.text();
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
    );
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ state: "COMPLETED" }),
    );
  });

  it("unanswered call → apology + NO_ANSWER", async () => {
    const res = await POST(
      makeRequest({ CallSid: "CA1", DialCallStatus: "no-answer" }),
    );
    const xml = await res.text();
    expect(xml).toContain("<Say>");
    expect(xml).toContain("<Hangup/>");
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ state: "NO_ANSWER" }),
    );
  });
});
