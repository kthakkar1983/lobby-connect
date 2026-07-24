import { describe, it, expect } from "vitest";
import { callPill, incidentPill } from "@/lib/owner/status-pill";

describe("callPill", () => {
  it("mint family for completed/in-progress", () => {
    expect(callPill("COMPLETED")).toEqual({ label: "Completed", variant: "live" });
    expect(callPill("IN_PROGRESS").variant).toBe("live");
  });
  it("neutral for ringing", () => {
    expect(callPill("RINGING").variant).toBe("muted");
  });
  it("blaze (attention) for missed", () => {
    expect(callPill("NO_ANSWER")).toEqual({ label: "Missed", variant: "attention" });
  });
  it("muted neutral for failed", () => {
    expect(callPill("FAILED")).toEqual({ label: "Failed", variant: "muted" });
  });
});

describe("incidentPill", () => {
  it("blaze (attention) for open, neutral for resolved", () => {
    expect(incidentPill("OPEN")).toEqual({ label: "Open", variant: "attention" });
    expect(incidentPill("RESOLVED")).toEqual({ label: "Resolved", variant: "muted" });
  });
});
