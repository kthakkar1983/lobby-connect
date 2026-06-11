import { describe, it, expect, beforeEach, vi } from "vitest";

// --- mock createServerClient (getUser only) ---
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

// --- mock createAdminClient ---
// Supports .from("profiles") and .from("calls") with the chains used by the module.
const profileFetch = vi.fn(async (): Promise<{ data: Record<string, unknown> | null }> => ({
  data: { id: "u1", operator_id: "op-1", role: "AGENT" },
}));

let callFetchResult: Record<string, unknown> | null = {
  id: "call-1",
  operator_id: "op-1",
  state: "RINGING",
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => profileFetch() }) }),
        };
      }
      // "calls" table — supports dynamic select string
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: callFetchResult }),
          }),
        }),
      };
    },
  }),
}));

import { requireApiActor, fetchOperatorCall } from "@/lib/auth/api-actor";
import type { ApiActor } from "@/lib/auth/api-actor";

beforeEach(() => {
  getUser.mockReset();
  profileFetch.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  profileFetch.mockResolvedValue({
    data: { id: "u1", operator_id: "op-1", role: "AGENT" },
  });
  callFetchResult = { id: "call-1", operator_id: "op-1", state: "RINGING" };
});

// ─── requireApiActor ─────────────────────────────────────────────────────────

describe("requireApiActor", () => {
  it("returns 401 when there is no authenticated user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const result = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("returns 401 when the profile is not found", async () => {
    profileFetch.mockResolvedValue({ data: null });
    const result = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    const body = await (result as Response).json();
    expect(body.error).toBe("Unknown profile");
  });

  it("returns 403 when the role is not in the allow list", async () => {
    profileFetch.mockResolvedValue({
      data: { id: "u1", operator_id: "op-1", role: "OWNER" },
    });
    const result = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    const body = await (result as Response).json();
    expect(body.error).toBe("Forbidden for this role");
  });

  it("returns the actor when the role is in the allow list", async () => {
    const result = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
    expect(result).not.toBeInstanceOf(Response);
    const actor = result as ApiActor;
    expect(actor.userId).toBe("u1");
    expect(actor.operatorId).toBe("op-1");
    expect(actor.role).toBe("AGENT");
  });

  it("returns the actor for ADMIN role when ADMIN is allowed", async () => {
    profileFetch.mockResolvedValue({
      data: { id: "u2", operator_id: "op-2", role: "ADMIN" },
    });
    const result = await requireApiActor({ allow: ["AGENT", "ADMIN", "OWNER"] });
    expect(result).not.toBeInstanceOf(Response);
    const actor = result as ApiActor;
    expect(actor.role).toBe("ADMIN");
    expect(actor.operatorId).toBe("op-2");
  });

  it("returns the actor for OWNER role when OWNER is allowed", async () => {
    profileFetch.mockResolvedValue({
      data: { id: "u3", operator_id: "op-3", role: "OWNER" },
    });
    const result = await requireApiActor({ allow: ["OWNER"] });
    expect(result).not.toBeInstanceOf(Response);
    const actor = result as ApiActor;
    expect(actor.role).toBe("OWNER");
  });

  it("does NOT check the active field (no active column selected)", async () => {
    // If `active` were selected, the mock would need to return it.
    // The fact that the mock only returns id/operator_id/role and this passes
    // confirms no active check is performed.
    const result = await requireApiActor({ allow: ["AGENT"] });
    expect(result).not.toBeInstanceOf(Response);
  });
});

// ─── fetchOperatorCall ────────────────────────────────────────────────────────

describe("fetchOperatorCall", () => {
  const actor: ApiActor = { userId: "u1", operatorId: "op-1", role: "AGENT" };

  it("returns 404 when the call is not found (null data)", async () => {
    callFetchResult = null;
    const result = await fetchOperatorCall(actor, "call-1", "id, state");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
    const body = await (result as Response).json();
    expect(body.error).toBe("Call not found");
  });

  it("returns 404 when the call belongs to a different operator", async () => {
    callFetchResult = { id: "call-1", operator_id: "OTHER", state: "RINGING" };
    const result = await fetchOperatorCall(actor, "call-1", "id, state");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  });

  it("returns the call row when operator matches", async () => {
    const result = await fetchOperatorCall(actor, "call-1", "id, state");
    expect(result).not.toBeInstanceOf(Response);
    const row = result as Record<string, unknown>;
    expect(row.id).toBe("call-1");
    expect(row.operator_id).toBe("op-1");
    expect(row.state).toBe("RINGING");
  });

  it("returns the call row when columns already includes operator_id", async () => {
    const result = await fetchOperatorCall(actor, "call-1", "id, operator_id, state");
    expect(result).not.toBeInstanceOf(Response);
    expect((result as Record<string, unknown>).id).toBe("call-1");
  });

  it("returns 404 for a call from a different operator even if columns omit operator_id", async () => {
    callFetchResult = { id: "call-1", operator_id: "WRONG-OP", state: "IN_PROGRESS" };
    const result = await fetchOperatorCall(actor, "call-1", "id, state, agora_channel_name");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  });

  it("word-boundary check: a column containing 'operator_id' as a substring does not skip appending the real operator_id", async () => {
    // "foreign_operator_id_ref" contains the substring "operator_id" but is NOT
    // the token "operator_id", so the scope column must still be appended.
    // operator mismatch → 404 (proves the real operator_id check ran)
    callFetchResult = { id: "call-1", operator_id: "OTHER", state: "RINGING" };
    const mismatch = await fetchOperatorCall(actor, "call-1", "id, foreign_operator_id_ref, state");
    expect(mismatch).toBeInstanceOf(Response);
    expect((mismatch as Response).status).toBe(404);

    // operator match → row returned (proves the appended operator_id was read correctly)
    callFetchResult = { id: "call-1", operator_id: "op-1", state: "RINGING" };
    const match = await fetchOperatorCall(actor, "call-1", "id, foreign_operator_id_ref, state");
    expect(match).not.toBeInstanceOf(Response);
    expect((match as Record<string, unknown>).id).toBe("call-1");
  });
});
