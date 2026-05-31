import { describe, it, expect } from "vitest";

import { planDial } from "@/lib/voice/plan-dial";

const agent = { id: "a1", twilioIdentity: "lc_a1" };
const adminX = { id: "x1", twilioIdentity: "lc_x1" };

describe("planDial", () => {
  it("agent only", () => {
    expect(planDial({ primaryAgent: agent, availableAdmins: [] })).toEqual([
      { identity: "lc_a1" },
    ]);
  });

  it("admins only (property unassigned)", () => {
    expect(
      planDial({ primaryAgent: null, availableAdmins: [adminX] }),
    ).toEqual([{ identity: "lc_x1" }]);
  });

  it("agent + distinct admins → all, agent first", () => {
    expect(
      planDial({ primaryAgent: agent, availableAdmins: [adminX] }),
    ).toEqual([{ identity: "lc_a1" }, { identity: "lc_x1" }]);
  });

  it("dedups the admin who is also the primary agent", () => {
    const both = { id: "a1", twilioIdentity: "lc_a1" };
    expect(
      planDial({ primaryAgent: agent, availableAdmins: [both, adminX] }),
    ).toEqual([{ identity: "lc_a1" }, { identity: "lc_x1" }]);
  });

  it("returns [] when nobody is reachable", () => {
    expect(planDial({ primaryAgent: null, availableAdmins: [] })).toEqual([]);
  });
});
