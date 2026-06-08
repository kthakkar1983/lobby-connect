import { describe, it, expect } from "vitest";
import { countOnlineAgents } from "@/lib/dashboard/presence";

const NOW = Date.parse("2026-06-08T02:00:00Z");
const fresh = "2026-06-08T01:59:30Z"; // 30s ago
const stale = "2026-06-08T01:50:00Z"; // 10m ago

describe("countOnlineAgents", () => {
  it("counts AVAILABLE/ON_CALL agents with a fresh last_seen_at", () => {
    const agents = [
      { status: "AVAILABLE", last_seen_at: fresh },
      { status: "ON_CALL", last_seen_at: fresh },
      { status: "AWAY", last_seen_at: fresh },       // not live
      { status: "AVAILABLE", last_seen_at: stale },  // stale
      { status: "AVAILABLE", last_seen_at: null },   // never seen
    ] as const;
    expect(countOnlineAgents(agents, NOW)).toBe(2);
  });
  it("is 0 for empty", () => {
    expect(countOnlineAgents([], NOW)).toBe(0);
  });
});
