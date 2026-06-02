import { describe, it, expect } from "vitest";
import { activeOwnerTab } from "@/lib/owner/nav";

describe("activeOwnerTab", () => {
  it("treats /owner and property drill-downs as Home", () => {
    expect(activeOwnerTab("/owner")).toBe("home");
    expect(activeOwnerTab("/owner/properties/abc")).toBe("home");
  });
  it("matches Calls on /owner/calls and its details", () => {
    expect(activeOwnerTab("/owner/calls")).toBe("calls");
    expect(activeOwnerTab("/owner/calls/123")).toBe("calls");
  });
  it("matches Incidents on /owner/incidents and its details", () => {
    expect(activeOwnerTab("/owner/incidents")).toBe("incidents");
    expect(activeOwnerTab("/owner/incidents/9")).toBe("incidents");
  });
});
