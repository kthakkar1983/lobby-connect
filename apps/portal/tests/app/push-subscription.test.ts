import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireApiActor, upsertSpy, upsertResult, deleteEqSpy } = vi.hoisted(() => ({
  requireApiActor: vi.fn(),
  upsertSpy: vi.fn(),
  upsertResult: { error: null as { message: string } | null },
  deleteEqSpy: vi.fn(),
}));

vi.mock("@/lib/auth/api-actor", () => ({
  requireApiActor: (...args: unknown[]) => requireApiActor(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table !== "push_subscriptions") throw new Error(`unexpected table ${table}`);
      return {
        upsert: (row: unknown, opts: unknown) => {
          upsertSpy(row, opts);
          return Promise.resolve(upsertResult);
        },
        // DELETE route: .delete().eq("endpoint", …).eq("user_id", …)
        delete: () => ({
          eq: (col1: string, val1: string) => ({
            eq: (col2: string, val2: string) => {
              deleteEqSpy([col1, val1], [col2, val2]);
              return Promise.resolve({ error: null });
            },
          }),
        }),
      };
    },
  }),
}));

import { POST, DELETE } from "@/app/api/push/subscription/route";

const ACTOR = { userId: "u-1", operatorId: "op-1", role: "AGENT" as const };

function req(body: unknown) {
  return new Request("http://localhost:3000/api/push/subscription", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireApiActor.mockReset();
  upsertSpy.mockReset();
  deleteEqSpy.mockReset();
  upsertResult.error = null;
  requireApiActor.mockResolvedValue(ACTOR);
});

describe("POST /api/push/subscription", () => {
  it("401 when unauthenticated (requireApiActor returns a 401 NextResponse)", async () => {
    requireApiActor.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST(req({ endpoint: "e", p256dh: "k", auth: "a" }));
    expect(res.status).toBe(401);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("400 when a subscription field is missing", async () => {
    const res = await POST(req({ endpoint: "e", p256dh: "k" }));
    expect(res.status).toBe(400);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("204 and upserts the actor's user/operator ids on endpoint conflict", async () => {
    const res = await POST(req({ endpoint: "https://push/1", p256dh: "k1", auth: "a1" }));
    expect(res.status).toBe(204);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const [row, opts] = upsertSpy.mock.calls[0]!;
    expect(row).toMatchObject({
      user_id: "u-1",
      operator_id: "op-1",
      endpoint: "https://push/1",
      p256dh: "k1",
      auth: "a1",
    });
    expect(typeof row.last_seen_at).toBe("string");
    expect(opts).toEqual({ onConflict: "endpoint" });
  });

  it("500 when the upsert errors", async () => {
    upsertResult.error = { message: "boom" };
    const res = await POST(req({ endpoint: "e", p256dh: "k", auth: "a" }));
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/push/subscription", () => {
  function delReq(body: unknown) {
    return new Request("http://localhost:3000/api/push/subscription", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("401 when unauthenticated", async () => {
    requireApiActor.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await DELETE(delReq({ endpoint: "e" }));
    expect(res.status).toBe(401);
    expect(deleteEqSpy).not.toHaveBeenCalled();
  });

  it("400 when the endpoint is missing", async () => {
    const res = await DELETE(delReq({}));
    expect(res.status).toBe(400);
    expect(deleteEqSpy).not.toHaveBeenCalled();
  });

  it("204 and scopes the delete to the actor's user id", async () => {
    const res = await DELETE(delReq({ endpoint: "https://push/1" }));
    expect(res.status).toBe(204);
    expect(deleteEqSpy).toHaveBeenCalledTimes(1);
    const [first, second] = deleteEqSpy.mock.calls[0]!;
    expect(first).toEqual(["endpoint", "https://push/1"]);
    expect(second).toEqual(["user_id", "u-1"]);
  });
});
