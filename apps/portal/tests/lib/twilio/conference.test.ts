import { describe, it, expect } from "vitest";
import { pickAgentLeg } from "@/lib/twilio/conference";

describe("pickAgentLeg", () => {
  it("returns the in-progress child leg's sid", () => {
    const sid = pickAgentLeg([
      { sid: "CAcompleted", status: "completed" },
      { sid: "CAlive", status: "in-progress" },
    ]);
    expect(sid).toBe("CAlive");
  });

  it("returns null when there is no in-progress child", () => {
    expect(pickAgentLeg([{ sid: "CAx", status: "completed" }])).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(pickAgentLeg([])).toBeNull();
  });
});
