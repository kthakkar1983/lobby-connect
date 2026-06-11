import { describe, it, expect, beforeEach, vi } from "vitest";

const validateTwilioSignature = vi.fn<() => boolean>();
const publicUrlFromRequest = vi.fn<() => string>(
  () => "https://abc.trycloudflare.com/api/twilio/voice/dial-result",
);
vi.mock("@/lib/twilio/client", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validateTwilioSignature: (...a: any[]) => (validateTwilioSignature as any)(...a),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicUrlFromRequest: (...a: any[]) => (publicUrlFromRequest as any)(...a),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseVerifiedTwilioWebhook: async (request: any) => {
    const { NextResponse } = await import("next/server");
    const form = await request.formData();
    const params: Record<string, string> = {};
    for (const [k, v] of form.entries()) params[k] = String(v);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(validateTwilioSignature as any)()) {
      return new NextResponse("Invalid signature", { status: 403 });
    }
    return { params };
  },
}));

const updateSpy = vi.fn<() => Promise<{ error: null }>>(
  () => Promise.resolve({ error: null }),
);
let dialResultCurrentState: string | null = "RINGING";
let dialResultEmergencyConf: string | null = null;
// Number of leading reads that should return a transient error (then succeed).
let dialResultReadErrors = 0;
function makeAdminClient() {
  return {
    from() {
      const builder: Record<string, unknown> = {};
      builder.update = (vals: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (updateSpy as any)(vals);
        return builder;
      };
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = () => {
        if (dialResultReadErrors > 0) {
          dialResultReadErrors--;
          return Promise.resolve({ data: null, error: { message: "blip" } });
        }
        return Promise.resolve({
          data: dialResultCurrentState
            ? { state: dialResultCurrentState, emergency_conference_name: dialResultEmergencyConf }
            : null,
          error: null,
        });
      };
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
  dialResultCurrentState = "RINGING";
  dialResultEmergencyConf = null;
  dialResultReadErrors = 0;
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

  it("does not overwrite an already-terminal state", async () => {
    dialResultCurrentState = "COMPLETED";
    await POST(makeRequest({ CallSid: "CA1", DialCallStatus: "no-answer" }));
    const vals = (updateSpy.mock.calls[0] as unknown as [Record<string, unknown>])?.[0];
    expect(vals).not.toHaveProperty("state");
  });

  it("routes the guest into the conference when the call is flagged emergency", async () => {
    dialResultEmergencyConf = "emg-call-1";
    const res = await POST(makeRequest({ CallSid: "CAparent", DialCallStatus: "completed" }));
    const xml = await res.text();
    expect(xml).toContain("<Conference");
    expect(xml).toContain("emg-call-1");
    // must NOT terminalize the call
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("retries a transient read error, then still routes the guest into the conference", async () => {
    // The first read blips; without retry this would fall through to a hangup,
    // stranding the guest mid-911. The retry must recover and route to 911.
    dialResultReadErrors = 1;
    dialResultEmergencyConf = "emg-call-1";
    const res = await POST(makeRequest({ CallSid: "CAparent", DialCallStatus: "completed" }));
    const xml = await res.text();
    expect(xml).toContain("<Conference");
    expect(xml).toContain("emg-call-1");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("does not terminalize the call when the read fails after all retries", async () => {
    // Persistent failure: we can't tell whether this call is mid-911, so we must
    // not clobber its state. Play the safe default audio without any DB write.
    dialResultReadErrors = 10;
    const res = await POST(makeRequest({ CallSid: "CAparent", DialCallStatus: "no-answer" }));
    const xml = await res.text();
    expect(xml).toContain("<Say>");
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
