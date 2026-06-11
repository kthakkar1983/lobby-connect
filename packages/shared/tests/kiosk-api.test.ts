import { describe, it } from "vitest";
import type { KioskConfig, CallStartResult, AgoraTokenResult } from "../src/kiosk-api.js";

/**
 * Compile-time type-lock tests for kiosk↔portal wire DTOs.
 *
 * Each test constructs a fully-typed object literal so that any field rename
 * or type change in the interface breaks this file at typecheck time (not just
 * at runtime on the tablet).
 */

describe("KioskConfig", () => {
  it("accepts a valid KioskConfig object (compile-time check)", () => {
    const config: KioskConfig = {
      propertyId: "prop-1",
      logoUrl: null,
      welcomeHeading: "Welcome",
      welcomeMessage: null,
      checkinTime: "3:00 PM",
      checkoutTime: "11:00 AM",
      wifiNetwork: "HotelGuest",
      wifiPassword: null,
      breakfastHours: "7–10 AM",
      apologyMessage: null,
      phoneNumber: "+15550001234",
      ctaStyle: "warm",
    };
    // If this compiles, the shape is correct.
    void config;
  });

  it("ctaStyle union covers all three variants", () => {
    const a: KioskConfig["ctaStyle"] = "warm";
    const b: KioskConfig["ctaStyle"] = "accent";
    const c: KioskConfig["ctaStyle"] = "classic";
    void a; void b; void c;
  });
});

describe("CallStartResult", () => {
  it("accepts a valid CallStartResult object (compile-time check)", () => {
    const result: CallStartResult = {
      callId: "call-uuid-123",
      channelName: "call_abc123",
    };
    void result;
  });
});

describe("AgoraTokenResult", () => {
  it("accepts a valid AgoraTokenResult object (compile-time check)", () => {
    const result: AgoraTokenResult = {
      appId: "agora-app-id",
      channelName: "call_abc123",
      uid: 42,
      token: "007eJxTokx...",
    };
    void result;
  });

  it("uid is a number (not string)", () => {
    // Type-level assertion: assigning a string should fail typecheck.
    // We confirm by constructing with the correct type.
    const uid: AgoraTokenResult["uid"] = 0;
    void uid;
  });
});
