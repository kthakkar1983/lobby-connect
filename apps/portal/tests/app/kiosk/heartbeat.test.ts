import { describe, it, expect, beforeEach, vi } from "vitest";
import { signKioskToken } from "@/lib/kiosk/config-token";

const SECRET = "unit-secret";
vi.stubEnv("KIOSK_CONFIG_SECRET", SECRET);

const stampKioskLiveness = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/kiosk/stamp-liveness", () => ({
  stampKioskLiveness: (...a: unknown[]) => stampKioskLiveness(...a),
}));

// The liveness stamp must be scheduled via next/server `after()` (guaranteed
// post-response work), NOT a bare `void` — a detached fetch is not guaranteed to
// run before the serverless function freezes. The spy runs its callback so the
// stampKioskLiveness assertions still hold.
const after = vi.hoisted(() =>
  vi.fn((cb: () => unknown) => {
    void cb();
  }),
);
vi.mock("next/server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, after };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

import { POST } from "@/app/api/kiosk/heartbeat/route";

function req(token?: string) {
  return new Request("http://localhost:3000/api/kiosk/heartbeat", {
    method: "POST",
    headers: token ? { "x-kiosk-token": token } : {},
  });
}

beforeEach(() => {
  stampKioskLiveness.mockClear();
  after.mockClear();
});

describe("POST /api/kiosk/heartbeat", () => {
  it("401 without a valid token", async () => {
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req("garbage"))).status).toBe(401);
  });

  it("204 with a valid token", async () => {
    expect((await POST(req(signKioskToken("prop-1", SECRET)))).status).toBe(204);
  });

  it("stamps kiosk liveness for the token's property on success", async () => {
    const res = await POST(req(signKioskToken("prop-1", SECRET)));
    expect(res.status).toBe(204);
    expect(after).toHaveBeenCalledTimes(1);
    expect(stampKioskLiveness).toHaveBeenCalledWith(expect.anything(), "prop-1");
  });

  it("does not stamp liveness on an invalid token", async () => {
    await POST(req("garbage"));
    expect(stampKioskLiveness).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });
});
