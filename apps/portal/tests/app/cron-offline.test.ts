import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ltSpy = vi.fn(() => ({ neq: () => Promise.resolve({ error: null, count: 2 }) }));
const updateSpy = vi.fn((_v: unknown) => ({ lt: ltSpy }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ update: (v: unknown) => updateSpy(v) }) }),
}));

import { GET } from "@/app/api/cron/mark-stale-offline/route";

function req(auth?: string) {
  return new Request("http://localhost:3000/api/cron/mark-stale-offline", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  updateSpy.mockClear();
  ltSpy.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/mark-stale-offline", () => {
  it("401 when CRON_SECRET is set but the header is wrong", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await GET(req("Bearer nope"));
    expect(res.status).toBe(401);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("sweeps stale rows to OFFLINE when authorized", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "OFFLINE" }),
    );
  });

  it("runs without auth when CRON_SECRET is unset (local/dev)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalled();
  });
});
