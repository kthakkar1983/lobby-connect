import { describe, it, expect } from "vitest";
import {
  callStateLabel,
  callStateBadgeVariant,
  incidentStatusLabel,
  incidentStatusBadgeVariant,
  presenceLabel,
  presenceDotClass,
  formatDuration,
  formatCallTime,
} from "@/lib/owner/format";

describe("callStateLabel", () => {
  it("maps every CallState to an owner-friendly label", () => {
    expect(callStateLabel("RINGING")).toBe("Ringing");
    expect(callStateLabel("IN_PROGRESS")).toBe("In progress");
    expect(callStateLabel("COMPLETED")).toBe("Completed");
    expect(callStateLabel("NO_ANSWER")).toBe("Missed");
    expect(callStateLabel("FAILED")).toBe("Failed");
  });
});

describe("callStateBadgeVariant", () => {
  it("uses destructive for missed/failed, default for answered", () => {
    expect(callStateBadgeVariant("COMPLETED")).toBe("default");
    expect(callStateBadgeVariant("IN_PROGRESS")).toBe("default");
    expect(callStateBadgeVariant("RINGING")).toBe("secondary");
    expect(callStateBadgeVariant("NO_ANSWER")).toBe("destructive");
    expect(callStateBadgeVariant("FAILED")).toBe("destructive");
  });
});

describe("incident mappers", () => {
  it("labels and colors OPEN vs RESOLVED", () => {
    expect(incidentStatusLabel("OPEN")).toBe("Open");
    expect(incidentStatusLabel("RESOLVED")).toBe("Resolved");
    expect(incidentStatusBadgeVariant("OPEN")).toBe("destructive");
    expect(incidentStatusBadgeVariant("RESOLVED")).toBe("secondary");
  });
});

describe("presence", () => {
  it("labels and dot-colors each ProfileStatus", () => {
    expect(presenceLabel("AVAILABLE")).toBe("Available");
    expect(presenceLabel("ON_CALL")).toBe("On call");
    expect(presenceLabel("AWAY")).toBe("Away");
    expect(presenceLabel("OFFLINE")).toBe("Offline");
    expect(presenceDotClass("AVAILABLE")).toBe("bg-emerald-500");
    expect(presenceDotClass("OFFLINE")).toBe("bg-zinc-300");
  });
});

describe("formatDuration", () => {
  it("renders m/s and a dash for empty", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(65)).toBe("1m 5s");
    expect(formatDuration(120)).toBe("2m 0s");
  });
});

describe("formatCallTime", () => {
  it("renders the instant in the property's timezone", () => {
    const iso = "2026-06-02T03:00:00Z";
    const ny = formatCallTime(iso, "America/New_York");
    const la = formatCallTime(iso, "America/Los_Angeles");
    expect(ny).not.toBe(la); // 11:00 PM vs 8:00 PM the prior day
    expect(ny).toContain("11:00");
  });
});
