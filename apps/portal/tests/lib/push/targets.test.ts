import { describe, it, expect } from "vitest";

import { resolveTargetUserIds } from "@/lib/push/targets";

type Admin = Parameters<typeof resolveTargetUserIds>[0];

/**
 * Build a minimal fake admin client whose `.from(table)` returns exactly the
 * method chain each query uses:
 *   property_assignments: .select().eq().is()  → { data }
 *   admin_call_availability: .select().eq().eq() → { data }
 */
function fakeAdmin(opts: {
  assigned: Array<{ primary_agent_id: string }>;
  covering: Array<{ profile_id: string }>;
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
      // admin_call_availability
      return {
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: opts.covering }),
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
