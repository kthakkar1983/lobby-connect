import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireApiActor, maybeSingleResult, selectSpy, logAuditEvent } = vi.hoisted(() => ({
  requireApiActor: vi.fn(),
  maybeSingleResult: {
    data: null as {
      peer_id: string;
      unattended_password: string;
      operator_id: string;
    } | null,
  },
  selectSpy: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/auth/api-actor", () => ({
  requireApiActor: (...args: unknown[]) => requireApiActor(...args),
}));

vi.mock("@/lib/auth/audit", () => ({
  logAuditEvent: (...args: unknown[]) => logAuditEvent(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table !== "property_remote_access") throw new Error(`unexpected table ${table}`);
      return {
        select: (cols: string) => {
          selectSpy(cols);
          return {
            eq: (col: string, val: string) => {
              expect(col).toBe("property_id");
              void val;
              return {
                maybeSingle: () => Promise.resolve(maybeSingleResult),
              };
            },
          };
        },
      };
    },
  }),
}));

import { GET } from "@/app/api/remote-access/[propertyId]/route";

const ACTOR = { userId: "u-1", operatorId: "op-1", role: "AGENT" as const };

function req(propertyId: string, query = "") {
  return new Request(`http://localhost:3000/api/remote-access/${propertyId}${query}`);
}

function ctx(propertyId: string) {
  return { params: Promise.resolve({ propertyId }) };
}

beforeEach(() => {
  requireApiActor.mockReset();
  selectSpy.mockReset();
  logAuditEvent.mockReset();
  maybeSingleResult.data = null;
  requireApiActor.mockResolvedValue(ACTOR);
  logAuditEvent.mockResolvedValue(undefined);
});

describe("GET /api/remote-access/[propertyId]", () => {
  it("401 when unauthenticated (returns the actor's NextResponse)", async () => {
    requireApiActor.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await GET(req("prop-1"), ctx("prop-1"));
    expect(res.status).toBe(401);
    expect(selectSpy).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("403 for a disallowed role (OWNER — requireApiActor's NextResponse passthrough)", async () => {
    requireApiActor.mockResolvedValue(
      NextResponse.json({ error: "Forbidden for this role" }, { status: 403 }),
    );
    const res = await GET(req("prop-1"), ctx("prop-1"));
    expect(res.status).toBe(403);
    // requireApiActor is called with AGENT+ADMIN only (OWNER not allowed).
    expect(requireApiActor).toHaveBeenCalledWith({ allow: ["AGENT", "ADMIN"] });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("404 with no-store when no credential row exists", async () => {
    maybeSingleResult.data = null;
    const res = await GET(req("prop-1"), ctx("prop-1"));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("404 when the row belongs to a different operator (no leak, no audit)", async () => {
    maybeSingleResult.data = {
      peer_id: "peer-9",
      unattended_password: "secret",
      operator_id: "op-OTHER",
    };
    const res = await GET(req("prop-1"), ctx("prop-1"));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("200 returns {peerId,password}, no-store, and audits trigger=connect by default", async () => {
    maybeSingleResult.data = {
      peer_id: "peer-9",
      unattended_password: "secret",
      operator_id: "op-1",
    };
    const res = await GET(req("prop-1"), ctx("prop-1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ peerId: "peer-9", password: "secret" });
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith({
      actorUserId: "u-1",
      action: "remote_access.credentials_issued",
      entityType: "property",
      entityId: "prop-1",
      details: { peer_id: "peer-9", trigger: "connect" },
    });
  });

  it("audits trigger=prewarm when ?trigger=prewarm is present", async () => {
    maybeSingleResult.data = {
      peer_id: "peer-9",
      unattended_password: "secret",
      operator_id: "op-1",
    };
    const res = await GET(req("prop-1", "?trigger=prewarm"), ctx("prop-1"));
    expect(res.status).toBe(200);
    const call = logAuditEvent.mock.calls[0]![0] as { details: { trigger: string } };
    expect(call.details.trigger).toBe("prewarm");
  });
});
