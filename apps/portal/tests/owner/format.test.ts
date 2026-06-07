import { describe, it, expect } from "vitest";
import {
  callStateLabel,
  incidentStatusLabel,
  presenceLabel,
  presenceDotClass,
  isLivePresence,
  formatTimeOnly,
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

describe("incident mappers", () => {
  it("labels OPEN vs RESOLVED", () => {
    expect(incidentStatusLabel("OPEN")).toBe("Open");
    expect(incidentStatusLabel("RESOLVED")).toBe("Resolved");
  });
});

describe("presence labels", () => {
  it("labels each ProfileStatus", () => {
    expect(presenceLabel("AVAILABLE")).toBe("Available");
    expect(presenceLabel("ON_CALL")).toBe("On call");
    expect(presenceLabel("AWAY")).toBe("Away");
    expect(presenceLabel("OFFLINE")).toBe("Offline");
  });
});

describe("presenceDotClass (brand tokens)", () => {
  it("maps to brand tokens", () => {
    expect(presenceDotClass("AVAILABLE")).toBe("bg-live");
    expect(presenceDotClass("ON_CALL")).toBe("bg-accent");
    expect(presenceDotClass("AWAY")).toBe("bg-muted-foreground");
    expect(presenceDotClass("OFFLINE")).toBe("bg-border");
  });
});

describe("isLivePresence", () => {
  it("true only for AVAILABLE/ON_CALL", () => {
    expect(isLivePresence("AVAILABLE")).toBe(true);
    expect(isLivePresence("ON_CALL")).toBe(true);
    expect(isLivePresence("AWAY")).toBe(false);
    expect(isLivePresence("OFFLINE")).toBe(false);
  });
});

describe("formatTimeOnly", () => {
  it("formats hour:minute in tz", () => {
    // 2026-06-07T02:42:00Z == 21:42 (9:42 PM) the prior day in America/Chicago
    expect(formatTimeOnly("2026-06-07T02:42:00Z", "America/Chicago")).toMatch(/9:42\s?PM/);
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
