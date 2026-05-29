// Pure decision logic for changing a property's primary-agent assignment.
// The action executes the returned plan with close-then-insert ordering so a
// mid-failure leaves the property unassigned (safe) rather than double-assigned.

export type CurrentAssignment = {
  id: string;
  primary_agent_id: string;
} | null;

export type AssignmentPlan =
  | { action: "noop" }
  | { action: "assign"; newAgentId: string }
  | { action: "reassign"; closeId: string; newAgentId: string }
  | { action: "unassign"; closeId: string };

export function planAssignmentChange(
  current: CurrentAssignment,
  desiredAgentId: string | null,
): AssignmentPlan {
  if (desiredAgentId === null) {
    return current ? { action: "unassign", closeId: current.id } : { action: "noop" };
  }
  if (!current) {
    return { action: "assign", newAgentId: desiredAgentId };
  }
  if (current.primary_agent_id === desiredAgentId) {
    return { action: "noop" };
  }
  return { action: "reassign", closeId: current.id, newAgentId: desiredAgentId };
}
