import { describe, it, expect } from "vitest";
import { callStateLabel } from "@/lib/owner/format";
import { callPill } from "@/lib/owner/status-pill";

describe("direction-aware call labels", () => {
  it("inbound NO_ANSWER stays 'Missed' (default direction unchanged)", () => {
    expect(callStateLabel("NO_ANSWER")).toBe("Missed");
    expect(callStateLabel("NO_ANSWER", "INBOUND")).toBe("Missed");
  });
  it("outbound NO_ANSWER reads 'No answer', not 'Missed'", () => {
    expect(callStateLabel("NO_ANSWER", "OUTBOUND")).toBe("No answer");
  });
  it("non-NO_ANSWER states are unaffected by direction", () => {
    expect(callStateLabel("COMPLETED", "OUTBOUND")).toBe(callStateLabel("COMPLETED"));
    expect(callStateLabel("RINGING", "OUTBOUND")).toBe(callStateLabel("RINGING"));
    expect(callStateLabel("IN_PROGRESS", "OUTBOUND")).toBe(callStateLabel("IN_PROGRESS"));
    expect(callStateLabel("FAILED", "OUTBOUND")).toBe(callStateLabel("FAILED"));
  });

  it("outbound NO_ANSWER pill is not the blaze/attention variant", () => {
    const inbound = callPill("NO_ANSWER", "INBOUND");
    const outbound = callPill("NO_ANSWER", "OUTBOUND");
    expect(inbound.variant).toBe("attention");
    expect(outbound.variant).not.toBe("attention");
    expect(outbound.label).toBe("No answer");
  });
  it("callPill defaults to INBOUND when direction is omitted (byte-identical for existing callers)", () => {
    expect(callPill("NO_ANSWER")).toEqual(callPill("NO_ANSWER", "INBOUND"));
    expect(callPill("COMPLETED")).toEqual(callPill("COMPLETED", "INBOUND"));
  });
  it("non-NO_ANSWER pills are unaffected by direction", () => {
    expect(callPill("COMPLETED", "OUTBOUND")).toEqual(callPill("COMPLETED"));
    expect(callPill("FAILED", "OUTBOUND")).toEqual(callPill("FAILED"));
  });
});
