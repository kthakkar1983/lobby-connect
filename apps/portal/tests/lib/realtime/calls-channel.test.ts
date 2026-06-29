import { describe, it, expect } from "vitest";
import { operatorCallsChannelTopic, CALLS_CHANGED_EVENT } from "@/lib/realtime/calls-channel";

describe("operatorCallsChannelTopic", () => {
  it("builds a per-operator calls topic", () => {
    expect(operatorCallsChannelTopic("op-123")).toBe("operator:op-123:calls");
  });
  it("places the operator id as the second colon segment (RLS parses split_part(topic, ':', 2))", () => {
    const topic = operatorCallsChannelTopic("abc-def");
    expect(topic.split(":")[1]).toBe("abc-def");
  });
});
describe("CALLS_CHANGED_EVENT", () => {
  it("is the stable event name shared by publisher and subscriber", () => {
    expect(CALLS_CHANGED_EVENT).toBe("calls-changed");
  });
});
