import { describe, it, expect } from "vitest";
import { copy } from "@/lib/copy";
import { connectErrorMessage } from "@/lib/remote-access/connect-error";

describe("empty-state copy is person-facing (Batch 4)", () => {
  it("ownerHome points to the admin, not the widget", () => {
    expect(copy.empty.ownerHome.description).toBe("Your admin assigns them.");
  });

  it("ownerCalls reads as a calm status", () => {
    expect(copy.empty.ownerCalls.description).toBe("It's been quiet.");
  });

  it("ownerPropertyCalls reads as a calm status", () => {
    expect(copy.empty.ownerPropertyCalls.description).toBe("It's been quiet here.");
  });

  it("ownerIncidents reads as a calm status", () => {
    expect(copy.empty.ownerIncidents.description).toBe("Nothing's come up.");
  });

  it("agentProperties points to the admin, not the widget", () => {
    expect(copy.empty.agentProperties.description).toBe(
      "Your admin will assign the properties you cover."
    );
  });

  it("agentCalls reads as a calm status", () => {
    expect(copy.empty.agentCalls.description).toBe("Quiet so far tonight.");
  });

  it("adminAudit reads as a calm status", () => {
    expect(copy.empty.adminAudit.description).toBe("Nothing logged yet.");
  });

  it("leaves the actionable teaching empties untouched", () => {
    expect(copy.empty.adminUsers.description).toBe("Add your team to get started.");
    expect(copy.empty.adminProperties.description).toBe(
      "Add your first property to start routing calls."
    );
  });

  it("leaves every title unchanged", () => {
    expect(copy.empty.ownerHome.title).toBe("No properties yet");
    expect(copy.empty.ownerCalls.title).toBe("No calls yet");
    expect(copy.empty.ownerPropertyCalls.title).toBe("No calls yet");
    expect(copy.empty.ownerIncidents.title).toBe("No emergencies");
    expect(copy.empty.agentProperties.title).toBe("No properties assigned");
    expect(copy.empty.agentCalls.title).toBe("No calls yet");
    expect(copy.empty.adminAudit.title).toBe("No activity yet");
    expect(copy.empty.adminUsers.title).toBe("No users yet");
    expect(copy.empty.adminProperties.title).toBe("No properties yet");
  });

  it("no empty-state description narrates the widget", () => {
    for (const v of Object.values(copy.empty)) {
      expect(v.description).not.toMatch(/will (appear|show|chart)/i);
    }
  });
});

describe("no em dashes in centralized copy (Batch 4)", () => {
  const strings: string[] = [];
  (function walk(o: unknown) {
    if (typeof o === "string") strings.push(o);
    else if (o && typeof o === "object") Object.values(o).forEach(walk);
  })(copy);

  it("copy.ts values have no em dash", () => {
    for (const s of strings) expect(s).not.toContain("—");
  });

  it("connectErrorMessage outputs have no em dash", () => {
    const outcomes: Array<Parameters<typeof connectErrorMessage>[0]> = [
      { launched: false, notConfigured: true },
      { launched: false, notConfigured: false },
      { launched: false },
    ];
    for (const outcome of outcomes) {
      for (const length of ["full", "compact"] as const) {
        const msg = connectErrorMessage(outcome, length);
        if (msg) expect(msg).not.toContain("—");
      }
    }
  });
});
