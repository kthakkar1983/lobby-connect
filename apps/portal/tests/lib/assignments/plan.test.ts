import { describe, expect, it } from "vitest";

describe("planAssignmentChange", () => {
  it("returns noop when no current assignment and desired is null", async () => {
    const { planAssignmentChange } = await import("@/lib/assignments/plan");
    expect(planAssignmentChange(null, null)).toEqual({ action: "noop" });
  });

  it("returns assign when no current assignment and an agent is desired", async () => {
    const { planAssignmentChange } = await import("@/lib/assignments/plan");
    expect(planAssignmentChange(null, "agent-1")).toEqual({
      action: "assign",
      newAgentId: "agent-1",
    });
  });

  it("returns noop when desired equals the current agent", async () => {
    const { planAssignmentChange } = await import("@/lib/assignments/plan");
    expect(
      planAssignmentChange({ id: "row-1", primary_agent_id: "agent-1" }, "agent-1"),
    ).toEqual({ action: "noop" });
  });

  it("returns reassign (close current + insert new) when desired differs", async () => {
    const { planAssignmentChange } = await import("@/lib/assignments/plan");
    expect(
      planAssignmentChange({ id: "row-1", primary_agent_id: "agent-1" }, "agent-2"),
    ).toEqual({ action: "reassign", closeId: "row-1", newAgentId: "agent-2" });
  });

  it("returns unassign when a current assignment exists and desired is null", async () => {
    const { planAssignmentChange } = await import("@/lib/assignments/plan");
    expect(
      planAssignmentChange({ id: "row-1", primary_agent_id: "agent-1" }, null),
    ).toEqual({ action: "unassign", closeId: "row-1" });
  });
});
