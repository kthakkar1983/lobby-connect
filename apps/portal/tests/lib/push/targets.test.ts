import { describe, it, expect } from "vitest";

import { resolveTargetUserIds } from "@/lib/push/targets";

type Admin = Parameters<typeof resolveTargetUserIds>[0];

/**
 * Build a minimal fake admin client whose `.from(table)` returns exactly the
 * method chain each query uses:
 *   property_assignments:    .select().eq().is()  → { data }
 *   admin_call_availability: .select().eq().eq()  → { data }
 *   profiles:                .select().in()        → { data } (raw status rows)
 *
 * `statuses` maps a user id → its raw `profiles.status`. Any id not present
 * defaults to "AVAILABLE" (present/on-shift), so callers only list the silenced
 * (OFFLINE/AWAY) ones they care about. Only ids in the built target set are queried.
 */
function fakeAdmin(opts: {
  assigned: Array<{ primary_agent_id: string }>;
  covering: Array<{ profile_id: string }>;
  statuses?: Record<string, string>;
}): Admin {
  return {
    from(table: string) {
      if (table === "property_assignments") {
        return {
          select: () => ({
            eq: () => ({
              is: () => Promise.resolve({ data: opts.assigned }),
            }),
          }),
        };
      }
      if (table === "admin_call_availability") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: opts.covering }),
            }),
          }),
        };
      }
      // profiles — raw status lookup for the OFFLINE (end-shift) exclusion.
      return {
        select: () => ({
          in: (_col: string, ids: string[]) =>
            Promise.resolve({
              data: ids.map((id) => ({ id, status: opts.statuses?.[id] ?? "AVAILABLE" })),
            }),
        }),
      };
    },
  } as unknown as Admin;
}

describe("resolveTargetUserIds", () => {
  it("returns the assigned agent plus every covering admin (deduped)", async () => {
    const admin = fakeAdmin({
      assigned: [{ primary_agent_id: "agent-1" }],
      covering: [{ profile_id: "admin-1" }, { profile_id: "admin-2" }],
    });
    const ids = await resolveTargetUserIds(admin, "prop-1");
    expect(ids.sort()).toEqual(["admin-1", "admin-2", "agent-1"]);
  });

  it("dedupes an admin who is also the assigned agent (appears once)", async () => {
    const admin = fakeAdmin({
      assigned: [{ primary_agent_id: "same-1" }],
      covering: [{ profile_id: "same-1" }, { profile_id: "admin-2" }],
    });
    const ids = await resolveTargetUserIds(admin, "prop-1");
    expect(ids.sort()).toEqual(["admin-2", "same-1"]);
    expect(ids.filter((id) => id === "same-1")).toHaveLength(1);
  });

  it("returns [] when nobody is assigned or covering", async () => {
    const admin = fakeAdmin({ assigned: [], covering: [] });
    const ids = await resolveTargetUserIds(admin, "prop-1");
    expect(ids).toEqual([]);
  });

  it("excludes a covering admin who has ended their shift (status OFFLINE)", async () => {
    const admin = fakeAdmin({
      assigned: [{ primary_agent_id: "agent-1" }],
      covering: [{ profile_id: "admin-1" }],
      statuses: { "agent-1": "AVAILABLE", "admin-1": "OFFLINE" },
    });
    const ids = await resolveTargetUserIds(admin, "prop-1");
    expect(ids).toEqual(["agent-1"]);
  });

  it("excludes a covering admin who is not accepting calls (status AWAY — audio parity)", async () => {
    // The "not accepting calls" toggle sets AWAY; an agent on a bathroom break who
    // isn't taking audio must not get video either. Audio already skips AWAY.
    const admin = fakeAdmin({
      assigned: [{ primary_agent_id: "agent-1" }],
      covering: [{ profile_id: "admin-1" }],
      statuses: { "agent-1": "AVAILABLE", "admin-1": "AWAY" },
    });
    const ids = await resolveTargetUserIds(admin, "prop-1");
    expect(ids).toEqual(["agent-1"]);
  });

  it("excludes both OFFLINE (off-shift) and AWAY (not accepting) targets together", async () => {
    const admin = fakeAdmin({
      assigned: [{ primary_agent_id: "agent-1" }],
      covering: [{ profile_id: "admin-1" }, { profile_id: "admin-2" }],
      statuses: { "agent-1": "AVAILABLE", "admin-1": "OFFLINE", "admin-2": "AWAY" },
    });
    const ids = await resolveTargetUserIds(admin, "prop-1");
    expect(ids).toEqual(["agent-1"]);
  });

  it("returns [] when the sole target has ended their shift (status OFFLINE)", async () => {
    const admin = fakeAdmin({
      assigned: [{ primary_agent_id: "agent-1" }],
      covering: [],
      statuses: { "agent-1": "OFFLINE" },
    });
    const ids = await resolveTargetUserIds(admin, "prop-1");
    expect(ids).toEqual([]);
  });

  it("keeps a stale-but-on-shift target (raw status AVAILABLE/ON_CALL, not OFFLINE/AWAY)", async () => {
    // A minimized on-shift tab throttles its heartbeat: effectivePresence would read
    // it stale, but the RAW status is still AVAILABLE/ON_CALL — push must still wake
    // it. Only the explicit OFFLINE/AWAY signals silence; AVAILABLE and ON_CALL are
    // the "kept" statuses (mirrors audio's reachable set).
    const admin = fakeAdmin({
      assigned: [{ primary_agent_id: "agent-1" }],
      covering: [{ profile_id: "admin-1" }],
      statuses: { "agent-1": "AVAILABLE", "admin-1": "ON_CALL" },
    });
    const ids = await resolveTargetUserIds(admin, "prop-1");
    expect(ids.sort()).toEqual(["admin-1", "agent-1"]);
  });

  it("fails OPEN: a null status result (transient DB error) drops nobody", async () => {
    // Real assigned + covering ids so the status query is actually reached, but it
    // returns { data: null } (a DB blip). Every resolved id must still be returned —
    // a status-read failure must never silently silence live agents. Regression
    // guard: do NOT flip `presence ?? []` to fail-closed.
    const admin = {
      from(table: string) {
        if (table === "property_assignments") {
          return {
            select: () => ({
              eq: () => ({ is: () => Promise.resolve({ data: [{ primary_agent_id: "agent-1" }] }) }),
            }),
          };
        }
        if (table === "admin_call_availability") {
          return {
            select: () => ({
              eq: () => ({ eq: () => Promise.resolve({ data: [{ profile_id: "admin-1" }] }) }),
            }),
          };
        }
        // profiles — the status lookup fails (null), simulating a transient error.
        return { select: () => ({ in: () => Promise.resolve({ data: null }) }) };
      },
    } as unknown as Admin;
    const ids = await resolveTargetUserIds(admin, "prop-1");
    expect(ids.sort()).toEqual(["admin-1", "agent-1"]);
  });

  it("tolerates null data from either query", async () => {
    const admin = {
      from(table: string) {
        if (table === "property_assignments") {
          return {
            select: () => ({ eq: () => ({ is: () => Promise.resolve({ data: null }) }) }),
          };
        }
        return {
          select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null }) }) }),
        };
      },
    } as unknown as Admin;
    expect(await resolveTargetUserIds(admin, "prop-1")).toEqual([]);
  });
});
