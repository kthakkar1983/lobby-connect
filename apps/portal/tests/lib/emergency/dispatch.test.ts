import { describe, it, expect, afterEach, vi } from "vitest";
import { getEmergencyDialNumber, getEmergencyCallerId } from "@/lib/emergency/dispatch";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getEmergencyDialNumber", () => {
  it("defaults to 911 when the env var is unset", () => {
    vi.stubEnv("EMERGENCY_DIAL_NUMBER", "");
    expect(getEmergencyDialNumber()).toBe("911");
  });

  it("returns the override when set (e.g. 933 for testing)", () => {
    vi.stubEnv("EMERGENCY_DIAL_NUMBER", "933");
    expect(getEmergencyDialNumber()).toBe("933");
  });

  it("trims surrounding whitespace", () => {
    vi.stubEnv("EMERGENCY_DIAL_NUMBER", "  933  ");
    expect(getEmergencyDialNumber()).toBe("933");
  });
});

describe("getEmergencyCallerId", () => {
  it("uses the property's routing_did when present", () => {
    expect(getEmergencyCallerId({ routing_did: "+14058750410" }, "+19999999999")).toBe("+14058750410");
  });

  it("falls back to the configured Twilio number when routing_did is null", () => {
    expect(getEmergencyCallerId({ routing_did: null }, "+14058750410")).toBe("+14058750410");
  });
});
