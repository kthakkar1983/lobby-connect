import { describe, it, expect, beforeEach, vi } from "vitest";

const upsertSpy = vi.fn((_v: unknown) => Promise.resolve({ error: null }));
let throwOnUpsert = false;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      upsert: (v: unknown) => {
        if (throwOnUpsert) throw new Error("db down");
        return upsertSpy(v);
      },
    }),
  }),
}));

import { recordHeartbeat } from "@/lib/health/heartbeat";

beforeEach(() => {
  upsertSpy.mockClear();
  throwOnUpsert = false;
});

describe("recordHeartbeat", () => {
  it("upserts operator_id + signal + last_ok_at", async () => {
    await recordHeartbeat("op1", "twilio_webhook");
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const payload = upsertSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.operator_id).toBe("op1");
    expect(payload.signal).toBe("twilio_webhook");
    expect(payload).toHaveProperty("last_ok_at");
  });

  it("never throws when the write fails (best-effort)", async () => {
    throwOnUpsert = true;
    await expect(recordHeartbeat("op1", "cron_mark_stale_offline")).resolves.toBeUndefined();
  });
});
