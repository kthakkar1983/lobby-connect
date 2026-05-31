import { describe, it, expect, beforeEach, vi } from "vitest";

const validateTwilioSignature = vi.fn();
const publicUrlFromRequest = vi.fn(
  () => "https://abc.trycloudflare.com/api/twilio/voice/status",
);
vi.mock("@/lib/twilio/client", () => ({
  validateTwilioSignature: (...a: unknown[]) => validateTwilioSignature(...a),
  publicUrlFromRequest: (...a: unknown[]) => publicUrlFromRequest(...a),
}));

let currentState: string | null = "RINGING";
const updateSpy = vi.fn(() => Promise.resolve({ error: null }));
function makeAdminClient() {
  return {
    from() {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = () =>
        Promise.resolve({ data: currentState ? { state: currentState } : null });
      builder.update = (vals: unknown) => {
        updateSpy(vals);
        return builder;
      };
      return builder;
    },
  };
}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminClient(),
}));

import { POST } from "@/app/api/twilio/voice/status/route";

function makeRequest(params: Record<string, string>) {
  return new Request("http://localhost:3000/api/twilio/voice/status", {
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
  currentState = "RINGING";
  validateTwilioSignature.mockReturnValue(true);
});

describe("POST /api/twilio/voice/status", () => {
  it("rejects an invalid signature with 403", async () => {
    validateTwilioSignature.mockReturnValue(false);
    const res = await POST(
      makeRequest({ CallSid: "CA1", CallStatus: "completed", CallDuration: "30" }),
    );
    expect(res.status).toBe(403);
  });

  it("finalizes a non-terminal call with state + duration", async () => {
    currentState = "RINGING";
    const res = await POST(
      makeRequest({ CallSid: "CA1", CallStatus: "completed", CallDuration: "30" }),
    );
    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ state: "COMPLETED", duration_seconds: 30 }),
    );
  });

  it("does not overwrite an already-terminal state but still records duration", async () => {
    currentState = "NO_ANSWER";
    await POST(
      makeRequest({ CallSid: "CA1", CallStatus: "completed", CallDuration: "5" }),
    );
    const vals = updateSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(vals).not.toHaveProperty("state");
    expect(vals).toMatchObject({ duration_seconds: 5 });
  });
});
