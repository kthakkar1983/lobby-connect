import { describe, it, expect, vi } from "vitest";
import { signKioskToken } from "@/lib/kiosk/config-token";

const SECRET = "unit-secret";
vi.stubEnv("KIOSK_CONFIG_SECRET", SECRET);

import { POST } from "@/app/api/kiosk/heartbeat/route";

function req(token?: string) {
  return new Request("http://localhost:3000/api/kiosk/heartbeat", {
    method: "POST",
    headers: token ? { "x-kiosk-token": token } : {},
  });
}

describe("POST /api/kiosk/heartbeat", () => {
  it("401 without a valid token", async () => {
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req("garbage"))).status).toBe(401);
  });

  it("204 with a valid token", async () => {
    expect((await POST(req(signKioskToken("prop-1", SECRET)))).status).toBe(204);
  });
});
