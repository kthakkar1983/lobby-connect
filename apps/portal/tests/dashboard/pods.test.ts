// apps/portal/tests/dashboard/pods.test.ts
import { describe, expect, it } from "vitest";
import { PRESENCE_STALE_AFTER_MS } from "@lc/shared";
import { cardLiveState, dutyLabel, groupPodsByAgent } from "@/lib/dashboard/pods";

const props = [
  { id: "p1", name: "Rosewood Inn", timezone: "America/Chicago" },
  { id: "p2", name: "Hilltop Suites", timezone: "America/Chicago" },
  { id: "p3", name: "The Sample Hotel", timezone: "America/New_York" },
];

describe("groupPodsByAgent", () => {
  it("groups assigned properties under their agent and trails unassigned", () => {
    const groups = groupPodsByAgent({
      properties: props,
      assignments: [
        { property_id: "p1", primary_agent_id: "a1" },
        { property_id: "p3", primary_agent_id: "a1" },
      ],
      agents: [{ id: "a1", full_name: "Dilnoza K", status: "AVAILABLE", last_seen_at: new Date().toISOString() }],
    });
    expect(groups).toHaveLength(2);
    expect(groups[0]!.agent?.full_name).toBe("Dilnoza K");
    expect(groups[0]!.properties.map((p) => p.name)).toEqual(["Rosewood Inn", "The Sample Hotel"]);
    expect(groups[1]!.agent).toBeNull(); // unassigned group
    expect(groups[1]!.properties.map((p) => p.id)).toEqual(["p2"]);
  });

  it("omits the unassigned group when every property is assigned", () => {
    const groups = groupPodsByAgent({
      properties: [props[0]!],
      assignments: [{ property_id: "p1", primary_agent_id: "a1" }],
      agents: [{ id: "a1", full_name: "Dilnoza K", status: "OFFLINE", last_seen_at: null }],
    });
    expect(groups).toHaveLength(1);
  });

  it("ignores an assignment referencing a property not in the list", () => {
    const groups = groupPodsByAgent({
      properties: [props[0]!],
      assignments: [
        { property_id: "p1", primary_agent_id: "a1" },
        { property_id: "does-not-exist", primary_agent_id: "a2" },
      ],
      agents: [
        { id: "a1", full_name: "Dilnoza K", status: "AVAILABLE", last_seen_at: new Date().toISOString() },
        { id: "a2", full_name: "Ghost Agent", status: "AVAILABLE", last_seen_at: new Date().toISOString() },
      ],
    });
    // Only the real property's group should appear; the phantom assignment
    // must not create a group with an empty properties array.
    expect(groups).toHaveLength(1);
    expect(groups[0]!.agent?.full_name).toBe("Dilnoza K");
  });

  it("gives a ghost-agent assignment a placeholder agent, never the unassigned group", () => {
    const groups = groupPodsByAgent({
      properties: props,
      assignments: [
        { property_id: "p1", primary_agent_id: "ghost-1" }, // no matching profile
      ],
      agents: [],
    });
    expect(groups).toHaveLength(2);
    expect(groups[0]!.agent).toEqual({
      id: "ghost-1",
      full_name: "Unknown agent",
      status: "OFFLINE",
      last_seen_at: null,
    });
    expect(groups[0]!.properties.map((p) => p.id)).toEqual(["p1"]);
    expect(groups[1]!.agent).toBeNull(); // p2 + p3 genuinely unassigned
    expect(groups[1]!.properties.map((p) => p.id)).toEqual(["p2", "p3"]);
  });
});

describe("cardLiveState", () => {
  it("ranks ringing above hold above on-call above quiet", () => {
    expect(cardLiveState({ ringing: true, onHold: true, onCall: true })).toBe("ringing");
    expect(cardLiveState({ ringing: false, onHold: true, onCall: true })).toBe("on-hold");
    expect(cardLiveState({ ringing: false, onHold: false, onCall: true })).toBe("on-call");
    expect(cardLiveState({ ringing: false, onHold: false, onCall: false })).toBe("quiet");
  });
});

describe("dutyLabel", () => {
  const now = Date.now();
  const fresh = new Date(now - 10_000).toISOString();
  const stale = new Date(now - PRESENCE_STALE_AFTER_MS - 1_000).toISOString();
  it("maps presence to duty labels", () => {
    expect(dutyLabel("AVAILABLE", fresh, now)).toBe("On duty");
    expect(dutyLabel("ON_CALL", fresh, now)).toBe("On call");
    expect(dutyLabel("AWAY", fresh, now)).toBe("Away");
    expect(dutyLabel("OFFLINE", fresh, now)).toBe("Off duty");
    expect(dutyLabel("AVAILABLE", stale, now)).toBe("Off duty");
  });
});
