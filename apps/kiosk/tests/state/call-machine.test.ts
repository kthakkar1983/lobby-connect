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

  it("home → ringing on tap (start connecting)", () => {
    const s = reduce(initialState(), { type: "TAP_CALL" });
    expect(s.screen).toBe("ringing");
  });

  it("TAP_CALL is a no-op when not on home", () => {
    const s: KioskState = { screen: "connected", callId: "c1", channelName: "call_abc" };
    expect(reduce(s, { type: "TAP_CALL" }).screen).toBe("connected");
  });

  it("CALL_STARTED records callId + channel and stays on ringing", () => {
    let s = reduce(initialState(), { type: "TAP_CALL" });
    s = reduce(s, { type: "CALL_STARTED", callId: "c1", channelName: "call_abc" });
    expect(s.screen).toBe("ringing");
    expect(s.callId).toBe("c1");
    expect(s.channelName).toBe("call_abc");
  });

  it("CALL_STARTED is ignored once the call is no longer ringing (cancelled mid-connect)", () => {
    const s: KioskState = { screen: "home", callId: null, channelName: null };
    const next = reduce(s, { type: "CALL_STARTED", callId: "c1", channelName: "call_abc" });
    expect(next.screen).toBe("home");
    expect(next.callId).toBeNull();
    expect(next.channelName).toBeNull();
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
});

describe("shouldFireRingTimeout (no-answer cutoff guard)", () => {
  it("fires while the call is still ringing", () => {
    expect(shouldFireRingTimeout("ringing")).toBe(true);
  });

  it("does NOT fire once the call has connected", () => {
    expect(shouldFireRingTimeout("connected")).toBe(false);
  });

  it("does NOT fire on home or apology", () => {
    expect(shouldFireRingTimeout("home")).toBe(false);
    expect(shouldFireRingTimeout("apology")).toBe(false);
  });
});
