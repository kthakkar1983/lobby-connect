import { describe, it, expect } from "vitest";
import {
  initialState,
  reduce,
  shouldFireRingTimeout,
  shouldEndForMaxDuration,
  isLockedOut,
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

describe("shouldEndForMaxDuration (connected-call cost cap guard)", () => {
  it("ends the call only while it is connected", () => {
    expect(shouldEndForMaxDuration("connected")).toBe(true);
  });

  it("is inert on every non-connected screen (already ended/home/ringing/apology)", () => {
    expect(shouldEndForMaxDuration("ringing")).toBe(false);
    expect(shouldEndForMaxDuration("home")).toBe(false);
    expect(shouldEndForMaxDuration("apology")).toBe(false);
  });
});

describe("outbound incoming-call transitions", () => {
  it("INCOMING_CALL moves home -> incoming and stores the call", () => {
    const s = reduce(initialState(), { type: "INCOMING_CALL", callId: "c1", channelName: "call_abc" });
    expect(s.screen).toBe("incoming");
    expect(s.callId).toBe("c1");
    expect(s.channelName).toBe("call_abc");
  });
  it("INCOMING_CALL is ignored when not on home (already in a call)", () => {
    const connected: KioskState = { screen: "connected", callId: "x", channelName: "call_x" };
    const s = reduce(connected, { type: "INCOMING_CALL", callId: "c2", channelName: "call_y" });
    expect(s).toEqual(connected);
  });
  it("ANSWER moves incoming -> ringing (the connecting screen), keeping the call", () => {
    const incoming: KioskState = { screen: "incoming", callId: "c1", channelName: "call_abc" };
    const s = reduce(incoming, { type: "ANSWER" });
    expect(s.screen).toBe("ringing");
    expect(s.callId).toBe("c1");
    expect(s.channelName).toBe("call_abc");
  });
  it("ANSWER is a no-op unless on the incoming screen", () => {
    const home = initialState();
    expect(reduce(home, { type: "ANSWER" })).toEqual(home);
  });
  it("AGENT_JOINED still moves ringing -> connected (reused for the answer path)", () => {
    const ringing: KioskState = { screen: "ringing", callId: "c1", channelName: "call_abc" };
    expect(reduce(ringing, { type: "AGENT_JOINED" }).screen).toBe("connected");
  });
  it("DROP returns to home from any state", () => {
    const connected: KioskState = { screen: "connected", callId: "x", channelName: "call_x" };
    expect(reduce(connected, { type: "DROP" })).toEqual(initialState());
  });
});

describe("isLockedOut", () => {
  const NOW = 1_000_000;
  it("no lockout timestamp -> not locked", () => {
    expect(isLockedOut(null, NOW)).toBe(false);
  });
  it("before the lockout expiry -> locked", () => {
    expect(isLockedOut(NOW + 5_000, NOW)).toBe(true);
  });
  it("at/after expiry -> not locked", () => {
    expect(isLockedOut(NOW, NOW)).toBe(false);
    expect(isLockedOut(NOW - 1, NOW)).toBe(false);
  });
});
