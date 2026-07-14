import { describe, it, expect } from "vitest";
import {
  encodeChat, decodeChat, newMessageId,
  shouldSendTyping, typingExpired,
  CHAT_PROTOCOL_VERSION, TYPING_THROTTLE_MS, TYPING_TIMEOUT_MS,
} from "../src/chat-protocol";

describe("encode/decode", () => {
  it("round-trips a message", () => {
    const env = { v: CHAT_PROTOCOL_VERSION, type: "msg" as const, id: "a", text: "hi", ts: 5 };
    expect(decodeChat(encodeChat(env))).toEqual(env);
  });
  it("round-trips a typing signal", () => {
    const env = { v: CHAT_PROTOCOL_VERSION, type: "typing" as const, state: "start" as const, ts: 5 };
    expect(decodeChat(encodeChat(env))).toEqual(env);
  });
  it("tolerantly rejects junk and unknown types", () => {
    expect(decodeChat(new TextEncoder().encode("not json"))).toBeNull();
    expect(decodeChat(new TextEncoder().encode(JSON.stringify({ v: 1, type: "wat", ts: 1 })))).toBeNull();
    expect(decodeChat(new TextEncoder().encode(JSON.stringify({ v: 1, type: "msg", ts: 1 })))).toBeNull(); // no text/id
  });
  it("ignores unknown extra fields (forward-compat)", () => {
    const wire = JSON.stringify({ v: 2, type: "msg", id: "a", text: "hi", ts: 5, lang: "es" });
    expect(decodeChat(new TextEncoder().encode(wire))).toEqual({ v: 2, type: "msg", id: "a", text: "hi", ts: 5 });
  });
});

describe("typing predicates", () => {
  it("throttles sends", () => {
    expect(shouldSendTyping(null, 0)).toBe(true);
    expect(shouldSendTyping(0, TYPING_THROTTLE_MS - 1)).toBe(false);
    expect(shouldSendTyping(0, TYPING_THROTTLE_MS)).toBe(true);
  });
  it("expires stale typing", () => {
    expect(typingExpired(0, TYPING_TIMEOUT_MS - 1)).toBe(false);
    expect(typingExpired(0, TYPING_TIMEOUT_MS)).toBe(true);
  });
});

describe("newMessageId", () => {
  it("returns distinct ids", () => {
    expect(newMessageId()).not.toBe(newMessageId());
  });
});
