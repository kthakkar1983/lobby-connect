import { describe, it, expect, beforeEach, vi } from "vitest";
import { signKioskToken } from "@/lib/kiosk/config-token";

const SECRET = "unit-secret";
vi.stubEnv("KIOSK_CONFIG_SECRET", SECRET);

let propertyRow: { id: string; operator_id: string; active: boolean } | null = null;
const insertSpy = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "properties") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: propertyRow }) }),
          }),
        };
      }
      // calls
      return {
        insert: (v: Record<string, unknown>) => {
          insertSpy(v);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: "call-1" } }),
            }),
          };
        },
      };
    },
  }),
}));

import { POST } from "@/app/api/kiosk/call-started/route";

function req(token?: string) {
  return new Request("http://localhost:3000/api/kiosk/call-started", {
    method: "POST",
    headers: token ? { "x-kiosk-token": token } : {},
  });
}

beforeEach(() => {
  insertSpy.mockClear();
  propertyRow = { id: "prop-1", operator_id: "op-1", active: true };
});

describe("POST /api/kiosk/call-started", () => {
  it("401 without a token", async () => {
    expect((await req()) && (await POST(req())).status).toBe(401);
  });

  it("inserts a VIDEO/RINGING call and returns callId + channelName", async () => {
    const token = signKioskToken("prop-1", SECRET);
    const res = await POST(req(token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.callId).toBe("call-1");
    expect(typeof body.channelName).toBe("string");
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operator_id: "op-1",
        property_id: "prop-1",
        channel: "VIDEO",
        state: "RINGING",
      }),
    );
    expect(insertSpy.mock.calls[0]?.[0]).toHaveProperty("agora_channel_name", body.channelName);
  });

  it("404 when the property is inactive", async () => {
    propertyRow = { id: "prop-1", operator_id: "op-1", active: false };
    const token = signKioskToken("prop-1", SECRET);
    expect((await POST(req(token))).status).toBe(404);
  });
});
