import { describe, it, expect, beforeEach, vi } from "vitest";

const validateTwilioSignature = vi.fn<() => boolean>();
const publicUrlFromRequest = vi.fn<() => string>(
  () => "https://abc.trycloudflare.com/api/twilio/voice/status",
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

let currentState: string | null = "RINGING";
const updateSpy = vi.fn<() => Promise<{ error: null }>>(
  () => Promise.resolve({ error: null }),
);
function makeAdminClient() {
  return {
    from() {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = () =>
        Promise.resolve({ data: currentState ? { state: currentState } : null });
      builder.update = (vals: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (updateSpy as any)(vals);
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

  it("promotes an already-answered (IN_PROGRESS) call to COMPLETED, without writing answered_at", async () => {
    currentState = "IN_PROGRESS";
    const res = await POST(
      makeRequest({ CallSid: "CA1", CallStatus: "completed", CallDuration: "30" }),
    );
    expect(res.status).toBe(204);
    const vals = (updateSpy.mock.calls[0] as unknown as [Record<string, unknown>])?.[0];
    expect(vals).toMatchObject({ state: "COMPLETED", duration_seconds: 30 });
    expect(vals).not.toHaveProperty("answered_at");
  });

  it("does NOT promote a never-answered RINGING call to COMPLETED (dial-result owns that)", async () => {
    currentState = "RINGING";
    const res = await POST(
      makeRequest({ CallSid: "CA1", CallStatus: "completed", CallDuration: "30" }),
    );
    expect(res.status).toBe(204);
    const vals = (updateSpy.mock.calls[0] as unknown as [Record<string, unknown>])?.[0];
    expect(vals).not.toHaveProperty("state");
    expect(vals).not.toHaveProperty("answered_at");
    expect(vals).toMatchObject({ duration_seconds: 30, ended_at: expect.any(String) });
  });

  it("does not overwrite an already-terminal state but still records duration", async () => {
    currentState = "NO_ANSWER";
    await POST(
      makeRequest({ CallSid: "CA1", CallStatus: "completed", CallDuration: "5" }),
    );
    const vals = (updateSpy.mock.calls[0] as unknown as [Record<string, unknown>])?.[0];
    expect(vals).not.toHaveProperty("state");
    expect(vals).toMatchObject({ duration_seconds: 5 });
  });

  it("returns 204 (not 500) on an internal error so Twilio does not retry", async () => {
    validateTwilioSignature.mockImplementation(() => {
      throw new Error("boom");
    });
    const res = await POST(
      makeRequest({ CallSid: "CA1", CallStatus: "completed", CallDuration: "5" }),
    );
    expect(res.status).toBe(204);
  });
});
