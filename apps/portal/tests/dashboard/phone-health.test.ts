import { describe, it, expect } from "vitest";
import {
  phoneHealthRollup,
  type PhoneHealthProperty,
  type PhoneHealthCall,
} from "@/lib/dashboard/phone-health";

const NOW = new Date("2026-06-08T02:00:00Z"); // Jun 7 9:00 PM America/Chicago

const PROPS: PhoneHealthProperty[] = [
  { id: "a", name: "Alpha", timeZone: "America/Chicago" },
  { id: "b", name: "Bravo", timeZone: "America/Chicago" },
];

describe("phoneHealthRollup", () => {
  it("flags a property with >= 1 FAILED call today; counts the rest ok", () => {
    const calls: PhoneHealthCall[] = [
      { property_id: "b", state: "FAILED", ring_started_at: "2026-06-08T01:00:00Z", timeZone: "America/Chicago" },
      { property_id: "a", state: "COMPLETED", ring_started_at: "2026-06-08T01:00:00Z", timeZone: "America/Chicago" },
    ];
    const r = phoneHealthRollup(PROPS, calls, NOW);
    expect(r.total).toBe(2);
    expect(r.ok).toBe(1);
    expect(r.needAttention.map((p) => p.id)).toEqual(["b"]);
    expect(r.needAttention[0]?.reasons).toEqual(["recent_failures"]);
  });

  it("ignores FAILED calls from earlier days", () => {
    const calls: PhoneHealthCall[] = [
      { property_id: "a", state: "FAILED", ring_started_at: "2026-06-06T01:00:00Z", timeZone: "America/Chicago" },
    ];
    expect(phoneHealthRollup(PROPS, calls, NOW).needAttention).toEqual([]);
  });

  // Regression: a property whose call was answered (or merely missed) must NOT read as
  // "needs attention". The old coverage-gap rule wrongly flagged a covered, answered
  // property whose primary agent happened to be offline.
  it("does NOT flag a property whose only calls are answered or missed (no FAILED)", () => {
    const calls: PhoneHealthCall[] = [
      { property_id: "a", state: "COMPLETED", ring_started_at: "2026-06-08T01:00:00Z", timeZone: "America/Chicago" },
      { property_id: "b", state: "NO_ANSWER", ring_started_at: "2026-06-08T01:10:00Z", timeZone: "America/Chicago" },
    ];
    const r = phoneHealthRollup(PROPS, calls, NOW);
    expect(r.needAttention).toEqual([]);
    expect(r.ok).toBe(2);
  });

  it("is all-ok when there are no calls", () => {
    expect(phoneHealthRollup(PROPS, [], NOW)).toEqual({ ok: 2, total: 2, needAttention: [] });
  });
});
