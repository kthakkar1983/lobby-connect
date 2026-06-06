import { describe, it, expect, beforeEach, vi } from "vitest";

// --- mocks -----------------------------------------------------------------
const validateTwilioSignature = vi.fn<() => boolean>();
const publicUrlFromRequest = vi.fn<() => string>(
  () => "https://abc.trycloudflare.com/api/twilio/voice/incoming",
);
vi.mock("@/lib/twilio/client", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validateTwilioSignature: (...a: any[]) => (validateTwilioSignature as any)(...a),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicUrlFromRequest: (...a: any[]) => (publicUrlFromRequest as any)(...a),
}));

// Per-table canned responses, settable per test.
type Canned = {
  property?: unknown;
  existingCall?: unknown;
  assignment?: unknown;
  agent?: unknown;
  availRows?: unknown[];
  admins?: unknown[];
};
let canned: Canned = {};
const insertSpy = vi.fn<() => Promise<{ error: null }>>(
  () => Promise.resolve({ error: null }),
);

function makeAdminClient() {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.in = chain;
      builder.is = chain;
      builder.insert = (row: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (insertSpy as any)(table, row);
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id: "call-1" }, error: null }),
          }),
        };
      };
      builder.maybeSingle = () => {
        if (table === "properties") return Promise.resolve({ data: canned.property ?? null });
        if (table === "calls") return Promise.resolve({ data: canned.existingCall ?? null });
        if (table === "property_assignments") return Promise.resolve({ data: canned.assignment ?? null });
        if (table === "profiles") return Promise.resolve({ data: canned.agent ?? null });
        return Promise.resolve({ data: null });
      };
      // admin_call_availability .select().eq().eq() resolves as a thenable list;
      // profiles admin lookup uses .in().eq()... then awaited as a list.
      builder.then = (resolve: (v: unknown) => void) => {
        if (table === "admin_call_availability") return resolve({ data: canned.availRows ?? [] });
        if (table === "profiles") return resolve({ data: canned.admins ?? [] });
        return resolve({ data: [] });
      };
      return builder;
    },
  };
}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminClient(),
}));

import { POST } from "@/app/api/twilio/voice/incoming/route";

function makeRequest(params: Record<string, string>) {
  const body = new URLSearchParams(params);
  return new Request("http://localhost:3000/api/twilio/voice/incoming", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": "sig",
    },
    body,
  });
}

beforeEach(() => {
  canned = {};
  insertSpy.mockClear();
  validateTwilioSignature.mockReturnValue(true);
});

describe("POST /api/twilio/voice/incoming", () => {
  it("rejects an invalid signature with 403", async () => {
    validateTwilioSignature.mockReturnValue(false);
    const res = await POST(makeRequest({ To: "+1", From: "+2", CallSid: "CA1" }));
    expect(res.status).toBe(403);
  });

  it("returns not-in-service apology when the property is unknown", async () => {
    canned.property = null;
    const res = await POST(makeRequest({ To: "+19999999999", From: "+2", CallSid: "CA1" }));
    const xml = await res.text();
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Dial");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("dials the assigned agent and inserts a RINGING call", async () => {
    canned.property = { id: "p1", operator_id: "op1", active: true, name: "Hotel One" };
    canned.assignment = { primary_agent_id: "a1" };
    canned.agent = { id: "a1", twilio_identity: "lc_a1", active: true };
    const res = await POST(makeRequest({ To: "+1", From: "+2", CallSid: "CA1" }));
    const xml = await res.text();
    expect(xml).toContain(
      '<Client><Identity>lc_a1</Identity>' +
        '<Parameter name="callId" value="call-1"/>' +
        '<Parameter name="propertyName" value="Hotel One"/></Client>',
    );
    expect(xml).toContain('action="https://abc.trycloudflare.com/api/twilio/voice/dial-result"');
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const [, row] = insertSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(row).toMatchObject({
      property_id: "p1",
      operator_id: "op1",
      channel: "AUDIO",
      state: "RINGING",
      twilio_call_sid: "CA1",
      caller_number: "+2",
    });
  });

  it("plays apology + records NO_ANSWER when nobody is reachable", async () => {
    canned.property = { id: "p1", operator_id: "op1", active: true, name: "Hotel One" };
    canned.assignment = null;
    canned.availRows = [];
    const res = await POST(makeRequest({ To: "+1", From: "+2", CallSid: "CA2" }));
    const xml = await res.text();
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Dial");
    const [, row] = insertSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(row).toMatchObject({ state: "NO_ANSWER" });
  });

  it("is idempotent — an existing call for the CallSid is not re-inserted", async () => {
    canned.property = { id: "p1", operator_id: "op1", active: true, name: "Hotel One" };
    canned.assignment = { primary_agent_id: "a1" };
    canned.agent = { id: "a1", twilio_identity: "lc_a1", active: true };
    canned.existingCall = { id: "call1" };
    await POST(makeRequest({ To: "+1", From: "+2", CallSid: "CA1" }));
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("dials both the assigned agent and an accepting admin", async () => {
    canned.property = { id: "p1", operator_id: "op1", active: true, name: "Hotel One" };
    canned.assignment = { primary_agent_id: "a1" };
    canned.agent = { id: "a1", twilio_identity: "lc_a1", active: true };
    canned.availRows = [{ profile_id: "x1" }];
    canned.admins = [{ id: "x1", twilio_identity: "lc_x1", active: true, role: "ADMIN", operator_id: "op1" }];
    const res = await POST(makeRequest({ To: "+1", From: "+2", CallSid: "CA1" }));
    const xml = await res.text();
    expect(xml).toContain("<Identity>lc_a1</Identity>");
    expect(xml).toContain("<Identity>lc_x1</Identity>");
  });
});
