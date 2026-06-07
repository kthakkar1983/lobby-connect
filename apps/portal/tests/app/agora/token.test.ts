import { describe, it, expect, beforeEach, vi } from "vitest";
import { signKioskToken } from "@/lib/kiosk/config-token";

const SECRET = "unit-secret";
vi.stubEnv("KIOSK_CONFIG_SECRET", SECRET);
vi.stubEnv("AGORA_APP_ID", "a".repeat(32));
vi.stubEnv("AGORA_APP_CERTIFICATE", "b".repeat(32));

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

let callRow: Record<string, unknown> | null = null;
let profileRow: Record<string, unknown> | null = null;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: table === "calls" ? callRow : profileRow }) }),
      }),
    }),
  }),
}));

import { GET } from "@/app/api/agora/token/route";

function url(params: Record<string, string>) {
  const u = new URL("http://localhost:3000/api/agora/token");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}
function req(params: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request(url(params), { headers });
}

beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
  callRow = { id: "call-1", property_id: "prop-1", operator_id: "op-1", state: "RINGING", agora_channel_name: "call_abc" };
  profileRow = { id: "u1", operator_id: "op-1" };
});

describe("GET /api/agora/token", () => {
  it("kiosk token path: returns a token for a channel in its property", async () => {
    const res = await GET(req({ channel: "call_abc", uid: "111" }, { "x-kiosk-token": signKioskToken("prop-1", SECRET) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token.startsWith("007")).toBe(true);
    expect(body.channelName).toBe("call_abc");
    expect(body.appId).toBe("a".repeat(32));
  });

  it("kiosk token path: 403 when the channel is not in its property", async () => {
    callRow = { ...callRow!, property_id: "OTHER" };
    const res = await GET(req({ channel: "call_abc", uid: "111" }, { "x-kiosk-token": signKioskToken("prop-1", SECRET) }));
    expect(res.status).toBe(403);
  });

  it("agent path: returns a token for a channel in its operator", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await GET(req({ channel: "call_abc", uid: "222" }));
    expect(res.status).toBe(200);
    expect((await res.json()).token.startsWith("007")).toBe(true);
  });

  it("agent path: 403 when the caller is an OWNER (read-only role)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    profileRow = { ...profileRow!, role: "OWNER" };
    const res = await GET(req({ channel: "call_abc", uid: "222" }));
    expect(res.status).toBe(403);
  });

  it("401 with neither kiosk token nor session", async () => {
    expect((await GET(req({ channel: "call_abc", uid: "1" }))).status).toBe(401);
  });

  it("400 when channel or uid is missing", async () => {
    expect((await GET(req({ uid: "1" }, { "x-kiosk-token": signKioskToken("prop-1", SECRET) }))).status).toBe(400);
  });
});
