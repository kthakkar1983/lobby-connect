import { describe, it, expect, beforeEach, vi } from "vitest";
import { signKioskToken } from "@/lib/kiosk/config-token";

const SECRET = "unit-secret";
vi.stubEnv("KIOSK_CONFIG_SECRET", SECRET);
vi.stubEnv("AGORA_APP_ID", "a".repeat(32));
vi.stubEnv("AGORA_APP_CERTIFICATE", "b".repeat(32));
vi.stubEnv("LIVEKIT_URL", "wss://livekit.lobby-connect.com");
vi.stubEnv("LIVEKIT_API_KEY", "lc_test");
vi.stubEnv("LIVEKIT_API_SECRET", "s".repeat(64));

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

import { GET } from "@/app/api/video/token/route";

function req(params: Record<string, string>, headers: Record<string, string> = {}) {
  const u = new URL("http://localhost:3000/api/video/token");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return new Request(u.toString(), { headers });
}

/** Decode a JWT payload without verifying (shape assertions only; no jose dep). */
function decodeJwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
}

beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
  callRow = { id: "call-1", property_id: "prop-1", operator_id: "op-1", state: "RINGING", agora_channel_name: "call_abc" };
  profileRow = { id: "u1", operator_id: "op-1", role: "AGENT", active: true };
  vi.stubEnv("VIDEO_PROVIDER", "");
});

describe("GET /api/video/token — agora branch (default)", () => {
  it("kiosk path returns the exact agora payload with provider discriminator", async () => {
    const res = await GET(req({ channel: "call_abc", uid: "111" }, { "x-kiosk-token": signKioskToken("prop-1", SECRET) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe("agora");
    expect(body.channelName).toBe("call_abc");
    expect(body.uid).toBe(111);
    expect(body.appId).toBe("a".repeat(32));
    expect(body.token.startsWith("007")).toBe(true);
  });
});

describe("GET /api/video/token — livekit branch", () => {
  beforeEach(() => vi.stubEnv("VIDEO_PROVIDER", "livekit"));

  it("kiosk path: identity 'kiosk', room-scoped grants, url from env", async () => {
    const res = await GET(req({ channel: "call_abc", uid: "111" }, { "x-kiosk-token": signKioskToken("prop-1", SECRET) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ provider: "livekit", url: "wss://livekit.lobby-connect.com", channelName: "call_abc" });
    expect(body.uid).toBeUndefined();
    const claims = decodeJwtPayload(body.token) as { sub: string; video: Record<string, unknown>; exp: number; iat?: number; nbf?: number };
    expect(claims.sub).toBe("kiosk");
    expect(claims.video).toMatchObject({ roomJoin: true, room: "call_abc", canPublish: true, canSubscribe: true });
    const issued = claims.iat ?? claims.nbf ?? 0;
    expect(claims.exp - issued).toBe(3600); // TTL parity with agora (D10)
  });

  it("session path: identity agent-<userId>", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await GET(req({ channel: "call_abc", uid: "222" }));
    expect(res.status).toBe(200);
    const claims = decodeJwtPayload((await res.json()).token) as { sub: string };
    expect(claims.sub).toBe("agent-u1");
  });

  it("OWNER is rejected on the session path", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    profileRow = { ...profileRow!, role: "OWNER" };
    expect((await GET(req({ channel: "call_abc", uid: "1" }))).status).toBe(403);
  });

  it("404 when the call is not in an active state", async () => {
    callRow = { ...callRow!, state: "COMPLETED" };
    const res = await GET(req({ channel: "call_abc", uid: "1" }, { "x-kiosk-token": signKioskToken("prop-1", SECRET) }));
    expect(res.status).toBe(404);
  });

  it("400 when channel or uid missing", async () => {
    expect((await GET(req({ uid: "1" }, { "x-kiosk-token": signKioskToken("prop-1", SECRET) }))).status).toBe(400);
  });

  it("401 with neither kiosk token nor session", async () => {
    expect((await GET(req({ channel: "call_abc", uid: "1" }))).status).toBe(401);
  });
});
