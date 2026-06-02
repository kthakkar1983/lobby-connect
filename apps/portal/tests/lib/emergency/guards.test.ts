import { describe, it, expect } from "vitest";
import { canTriggerEmergency } from "@/lib/emergency/guards";

const base = {
  state: "IN_PROGRESS",
  channel: "AUDIO",
  handledByUserId: "u1",
  userId: "u1",
};

describe("canTriggerEmergency", () => {
  it("allows the handling agent on an in-progress audio call", () => {
    expect(canTriggerEmergency(base)).toBe(true);
  });

  it("rejects when the call is not in progress", () => {
    expect(canTriggerEmergency({ ...base, state: "RINGING" })).toBe(false);
  });

  it("rejects video calls (emergency is audio-only in v1)", () => {
    expect(canTriggerEmergency({ ...base, channel: "VIDEO" })).toBe(false);
  });

  it("rejects a user who is not the handling agent", () => {
    expect(canTriggerEmergency({ ...base, handledByUserId: "other" })).toBe(false);
  });

  it("rejects when nobody is handling the call yet", () => {
    expect(canTriggerEmergency({ ...base, handledByUserId: null })).toBe(false);
  });
});
