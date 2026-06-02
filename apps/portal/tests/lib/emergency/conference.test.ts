import { describe, it, expect } from "vitest";
import {
  emergencyConferenceName,
  buildConferenceTwiml,
  shouldRouteToEmergencyConference,
} from "@/lib/emergency/conference";

describe("emergencyConferenceName", () => {
  it("derives a stable name from the call id", () => {
    expect(emergencyConferenceName("call-123")).toBe("emg-call-123");
  });
});

describe("buildConferenceTwiml", () => {
  it("builds a Dial>Conference that starts on enter and survives the agent leaving", () => {
    const xml = buildConferenceTwiml("emg-call-123");
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response><Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="false" beep="false">' +
        "emg-call-123" +
        "</Conference></Dial></Response>",
    );
  });

  it("escapes XML in the conference name", () => {
    expect(buildConferenceTwiml('emg-a&b')).toContain("emg-a&amp;b");
  });
});

describe("shouldRouteToEmergencyConference", () => {
  it("is true only when a conference name is stamped on the call", () => {
    expect(shouldRouteToEmergencyConference({ emergency_conference_name: "emg-x" })).toBe(true);
    expect(shouldRouteToEmergencyConference({ emergency_conference_name: null })).toBe(false);
  });
});
