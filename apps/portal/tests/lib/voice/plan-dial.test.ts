import { describe, it, expect } from "vitest";

import { planDial, MAX_DIAL_TARGETS } from "@/lib/voice/plan-dial";

const agent = { id: "a1", twilioIdentity: "lc_a1" };
const adminX = { id: "x1", twilioIdentity: "lc_x1" };

describe("planDial", () => {
  it("agent only", () => {
    expect(planDial({ primaryAgent: agent, availableAdmins: [] }).targets).toEqual([
      { identity: "lc_a1" },
    ]);
  });

  it("admins only (property unassigned)", () => {
    expect(
      planDial({ primaryAgent: null, availableAdmins: [adminX] }).targets,
    ).toEqual([{ identity: "lc_x1" }]);
  });

  it("agent + distinct admins → all, agent first", () => {
    expect(
      planDial({ primaryAgent: agent, availableAdmins: [adminX] }).targets,
    ).toEqual([{ identity: "lc_a1" }, { identity: "lc_x1" }]);
  });

  it("dedups the admin who is also the primary agent", () => {
    const both = { id: "a1", twilioIdentity: "lc_a1" };
    expect(
      planDial({ primaryAgent: agent, availableAdmins: [both, adminX] }).targets,
    ).toEqual([{ identity: "lc_a1" }, { identity: "lc_x1" }]);
  });

  it("returns [] when nobody is reachable", () => {
    expect(planDial({ primaryAgent: null, availableAdmins: [] }).targets).toEqual([]);
  });
});

const cand = (n: number) => ({ id: `u${n}`, twilioIdentity: `lc_${n}` });

describe("planDial fan-out cap (S2)", () => {
  it("caps at MAX_DIAL_TARGETS and reports droppedCount, priority preserved", () => {
    const admins = Array.from({ length: 11 }, (_, i) => cand(i + 1));
    const plan = planDial({ primaryAgent: null, availableAdmins: admins });
    expect(plan.targets).toHaveLength(MAX_DIAL_TARGETS);
    expect(plan.droppedCount).toBe(1);
    expect(plan.targets[0]!.identity).toBe("lc_1");
  });
  it("does not drop within the cap", () => {
    const plan = planDial({ primaryAgent: cand(1), availableAdmins: [cand(2)] });
    expect(plan.targets).toHaveLength(2);
    expect(plan.droppedCount).toBe(0);
  });
  it("dedupes before capping", () => {
    const plan = planDial({ primaryAgent: cand(1), availableAdmins: [cand(1), cand(2)] });
    expect(plan.targets.map((t) => t.identity)).toEqual(["lc_1", "lc_2"]);
    expect(plan.droppedCount).toBe(0);
  });
});
