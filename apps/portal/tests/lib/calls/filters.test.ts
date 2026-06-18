import { describe, it, expect } from "vitest";
import { parseOutcome, statesForOutcome, buildCallsHref } from "@/lib/calls/filters";

describe("parseOutcome", () => {
  it("accepts the three known outcomes", () => {
    expect(parseOutcome("answered")).toBe("answered");
    expect(parseOutcome("missed")).toBe("missed");
    expect(parseOutcome("failed")).toBe("failed");
  });
  it("returns null for anything else", () => {
    expect(parseOutcome(undefined)).toBeNull();
    expect(parseOutcome("")).toBeNull();
    expect(parseOutcome("ANSWERED")).toBeNull();
    expect(parseOutcome("live")).toBeNull();
  });
});

describe("statesForOutcome", () => {
  it("maps each outcome to its terminal call state(s)", () => {
    expect(statesForOutcome("answered")).toEqual(["COMPLETED"]);
    expect(statesForOutcome("missed")).toEqual(["NO_ANSWER"]);
    expect(statesForOutcome("failed")).toEqual(["FAILED"]);
  });
});

describe("buildCallsHref", () => {
  it("omits empty params and keeps a clean path", () => {
    expect(buildCallsHref("/owner/calls", {})).toBe("/owner/calls");
  });
  it("serializes the set params in a stable order", () => {
    expect(
      buildCallsHref("/admin/calls", { property: "p1", channel: "VIDEO", outcome: "missed" }),
    ).toBe("/admin/calls?property=p1&channel=VIDEO&outcome=missed");
  });
  it("carries a pagination cursor when present", () => {
    expect(buildCallsHref("/owner/calls", { outcome: "answered", before: "2026-06-17T00:00:00Z~abc" }))
      .toBe("/owner/calls?outcome=answered&before=2026-06-17T00%3A00%3A00Z~abc");
  });
});
