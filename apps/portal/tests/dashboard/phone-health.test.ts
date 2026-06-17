import { describe, it, expect } from "vitest";
import {
  phoneHealthRollup,
  type PhoneHealthProperty,
  type PhoneHealthCall,
} from "@/lib/dashboard/phone-health";

const NOW = new Date("2026-06-08T02:00:00Z"); // Jun 7 9:00 PM America/Chicago

const PROPS: PhoneHealthProperty[] = [
  { id: "a", name: "Alpha", timeZone: "America/Chicago", accepting: true, agentLive: true }, // healthy
  { id: "b", name: "Bravo", timeZone: "America/Chicago", accepting: true, agentLive: false }, // coverage gap
  { id: "c", name: "Charlie", timeZone: "America/Chicago", accepting: false, agentLive: false }, // failures below
];

const CALLS: PhoneHealthCall[] = [
  { property_id: "c", state: "FAILED", ring_started_at: "2026-06-08T01:00:00Z", timeZone: "America/Chicago" }, // today FAILED -> c
  { property_id: "a", state: "FAILED", ring_started_at: "2026-06-06T01:00:00Z", timeZone: "America/Chicago" }, // not today -> ignored
  { property_id: "a", state: "COMPLETED", ring_started_at: "2026-06-08T01:00:00Z", timeZone: "America/Chicago" }, // fine
];

describe("phoneHealthRollup", () => {
  it("flags coverage gaps and recent failures, counts the rest ok", () => {
    const r = phoneHealthRollup(PROPS, CALLS, { stale: false }, NOW);
    expect(r.pathDown).toBe(false);
    expect(r.total).toBe(3);
    expect(r.needAttention.map((p) => p.id).sort()).toEqual(["b", "c"]);
    expect(r.ok).toBe(1);
    expect(r.needAttention.find((p) => p.id === "b")?.reasons).toContain("coverage_gap");
    expect(r.needAttention.find((p) => p.id === "c")?.reasons).toContain("recent_failures");
  });

  it("combines reasons when a property has both a coverage gap and recent failures", () => {
    const props: PhoneHealthProperty[] = [
      { id: "d", name: "Delta", timeZone: "America/Chicago", accepting: true, agentLive: false },
    ];
    const calls: PhoneHealthCall[] = [
      { property_id: "d", state: "FAILED", ring_started_at: "2026-06-08T01:00:00Z", timeZone: "America/Chicago" },
    ];
    const d = phoneHealthRollup(props, calls, { stale: false }, NOW).needAttention.find((p) => p.id === "d");
    expect(d?.reasons.slice().sort()).toEqual(["coverage_gap", "recent_failures"]);
  });

  it("reports the whole path down when the heartbeat is stale or missing", () => {
    expect(phoneHealthRollup(PROPS, CALLS, { stale: true }, NOW).pathDown).toBe(true);
    expect(phoneHealthRollup(PROPS, CALLS, null, NOW).pathDown).toBe(true);
  });

  it("is all-ok when every property is covered and healthy", () => {
    const props: PhoneHealthProperty[] = [
      { id: "a", name: "Alpha", timeZone: "America/Chicago", accepting: true, agentLive: true },
      { id: "b", name: "Bravo", timeZone: "America/Chicago", accepting: false, agentLive: false }, // not accepting -> no gap
    ];
    expect(phoneHealthRollup(props, [], { stale: false }, NOW)).toEqual({
      pathDown: false,
      ok: 2,
      total: 2,
      needAttention: [],
    });
  });
});
