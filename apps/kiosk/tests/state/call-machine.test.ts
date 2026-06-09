import { describe, it, expect } from "vitest";
import {
  initialState,
  reduce,
  shouldFireRingTimeout,
  type KioskState,
} from "@/state/call-machine";

describe("kiosk call machine", () => {
  it("starts at home", () => {
    expect(initialState().screen).toBe("home");
  });

  it("home → disclosure on tap", () => {
    const s = reduce(initialState(), { type: "TAP_CALL" });
    expect(s.screen).toBe("disclosure");
  });

  it("disclosure → ringing on accept (records callId + channel)", () => {
    let s = reduce(initialState(), { type: "TAP_CALL" });
    s = reduce(s, { type: "ACCEPT_DISCLOSURE", callId: "c1", channelName: "call_abc" });
    expect(s.screen).toBe("ringing");
    expect(s.callId).toBe("c1");
    expect(s.channelName).toBe("call_abc");
  });

  it("ringing → connected when the agent joins", () => {
    let s: KioskState = { screen: "ringing", callId: "c1", channelName: "call_abc" };
    s = reduce(s, { type: "AGENT_JOINED" });
    expect(s.screen).toBe("connected");
  });

  it("ringing → apology on 120s timeout", () => {
    let s: KioskState = { screen: "ringing", callId: "c1", channelName: "call_abc" };
    s = reduce(s, { type: "RING_TIMEOUT" });
    expect(s.screen).toBe("apology");
  });

  it("connected → home on end", () => {
    let s: KioskState = { screen: "connected", callId: "c1", channelName: "call_abc" };
    s = reduce(s, { type: "END_CALL" });
    expect(s.screen).toBe("home");
  });

  it("ringing → home on cancel", () => {
    let s: KioskState = { screen: "ringing", callId: "c1", channelName: "call_abc" };
    s = reduce(s, { type: "CANCEL" });
    expect(s.screen).toBe("home");
  });

  it("apology → home on dismiss", () => {
    let s: KioskState = { screen: "apology", callId: null, channelName: null };
    s = reduce(s, { type: "DISMISS_APOLOGY" });
    expect(s.screen).toBe("home");
  });

  it("any → apology on error", () => {
    let s: KioskState = { screen: "ringing", callId: "c1", channelName: "call_abc" };
    s = reduce(s, { type: "ERROR" });
    expect(s.screen).toBe("apology");
  });

  it("disclosure → home on close", () => {
    let s = reduce(initialState(), { type: "TAP_CALL" });
    expect(s.screen).toBe("disclosure");
    s = reduce(s, { type: "CLOSE_DISCLOSURE" });
    expect(s.screen).toBe("home");
  });

  it("CLOSE_DISCLOSURE is a no-op off the disclosure screen", () => {
    const s: KioskState = { screen: "ringing", callId: "c1", channelName: "call_abc" };
    expect(reduce(s, { type: "CLOSE_DISCLOSURE" }).screen).toBe("ringing");
  });
});

describe("shouldFireRingTimeout (no-answer cutoff guard)", () => {
  it("fires while the call is still ringing", () => {
    expect(shouldFireRingTimeout("ringing")).toBe(true);
  });

  // Regression: the 120s ring timer is armed at ringing and was never cleared on
  // connect, so it fired mid-call — tearing down Agora and stranding the kiosk on
  // the live screen. The cutoff must be inert once the agent has joined.
  it("does NOT fire once the call has connected", () => {
    expect(shouldFireRingTimeout("connected")).toBe(false);
  });

  it("does NOT fire on home, disclosure, or apology", () => {
    expect(shouldFireRingTimeout("home")).toBe(false);
    expect(shouldFireRingTimeout("disclosure")).toBe(false);
    expect(shouldFireRingTimeout("apology")).toBe(false);
  });
});
