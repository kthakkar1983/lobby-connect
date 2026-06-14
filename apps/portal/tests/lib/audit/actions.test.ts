import { describe, it, expect } from "vitest";
import { AUDIT_ACTIONS, KNOWN_ACTIONS } from "@/lib/audit/actions";

describe("audit action vocabulary", () => {
  it("KNOWN_ACTIONS is derived from AUDIT_ACTIONS (no hand-sync)", () => {
    expect(KNOWN_ACTIONS).toEqual(Object.values(AUDIT_ACTIONS));
  });
  it("includes the load-bearing actions", () => {
    expect(KNOWN_ACTIONS).toContain("trigger_emergency");
    expect(KNOWN_ACTIONS).toContain("user.created");
    expect(KNOWN_ACTIONS).toContain("property.playbook_uploaded");
  });
});
