import { describe, it, expect, beforeEach, vi } from "vitest";

const upsertSpy = vi.fn((_v: unknown) => Promise.resolve({ error: null }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "profiles") {
        return { update: () => ({ lt: () => ({ neq: () => Promise.resolve({ error: null }) }) }) };
      }
      if (table === "operators") {
        return { select: () => Promise.resolve({ data: [{ id: "op1" }], error: null }) };
      }
      if (table === "health_signals") {
        return { upsert: (v: unknown) => upsertSpy(v) };
      }
      return {};
    },
  }),
}));

import { GET } from "@/app/api/cron/mark-stale-offline/route";

beforeEach(() => upsertSpy.mockClear());

describe("cron mark-stale-offline heartbeat", () => {
  it("records a cron heartbeat per operator after the sweep", async () => {
    delete process.env.CRON_SECRET; // no auth gate in test
    const res = await GET(new Request("http://localhost:3000/api/cron/mark-stale-offline"));
    expect(res.status).toBe(200);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const payload = upsertSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.operator_id).toBe("op1");
    expect(payload.signal).toBe("cron_mark_stale_offline");
  });
});
