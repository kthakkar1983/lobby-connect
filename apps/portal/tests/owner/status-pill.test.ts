import { describe, it, expect } from "vitest";
import { callPill, incidentPill } from "@/lib/owner/status-pill";

describe("callPill", () => {
  it("mint family for completed/in-progress", () => {
    expect(callPill("COMPLETED")).toEqual({ label: "Completed", className: "bg-live/15 text-live-foreground" });
    expect(callPill("IN_PROGRESS").className).toBe("bg-live/15 text-live-foreground");
  });
  it("neutral for ringing", () => {
    expect(callPill("RINGING").className).toBe("bg-muted text-muted-foreground");
  });
  it("coral for missed/failed", () => {
    expect(callPill("NO_ANSWER")).toEqual({ label: "Missed", className: "bg-accent/15 text-accent-strong" });
    expect(callPill("FAILED").className).toBe("bg-accent/15 text-accent-strong");
  });
});

describe("incidentPill", () => {
  it("destructive red for open, neutral for resolved", () => {
    expect(incidentPill("OPEN")).toEqual({ label: "Open", className: "bg-destructive/10 text-destructive" });
    expect(incidentPill("RESOLVED")).toEqual({ label: "Resolved", className: "bg-muted text-muted-foreground" });
  });
});
