import { describe, it, expect } from "vitest";

import {
  resolveDialResult,
  mapFinalCallState,
  isTerminalState,
  parseDurationSeconds,
} from "@/lib/voice/result";

describe("resolveDialResult", () => {
  it("completed → COMPLETED + hangup", () => {
    expect(resolveDialResult("completed")).toEqual({
      finalState: "COMPLETED",
      hangup: true,
    });
  });

  it("anything else → NO_ANSWER + apology (no hangup)", () => {
    for (const s of ["no-answer", "busy", "failed", "canceled"]) {
      expect(resolveDialResult(s)).toEqual({
        finalState: "NO_ANSWER",
        hangup: false,
      });
    }
  });
});

describe("mapFinalCallState", () => {
  it("maps terminal Twilio call statuses", () => {
    expect(mapFinalCallState("completed")).toBe("COMPLETED");
    expect(mapFinalCallState("failed")).toBe("FAILED");
    expect(mapFinalCallState("canceled")).toBe("FAILED");
    expect(mapFinalCallState("busy")).toBe("NO_ANSWER");
    expect(mapFinalCallState("no-answer")).toBe("NO_ANSWER");
  });

  it("returns null for non-terminal statuses", () => {
    expect(mapFinalCallState("ringing")).toBeNull();
    expect(mapFinalCallState("in-progress")).toBeNull();
  });
});

describe("isTerminalState", () => {
  it("recognizes terminal call states", () => {
    expect(isTerminalState("COMPLETED")).toBe(true);
    expect(isTerminalState("NO_ANSWER")).toBe(true);
    expect(isTerminalState("FAILED")).toBe(true);
    expect(isTerminalState("RINGING")).toBe(false);
  });
});

describe("parseDurationSeconds", () => {
  it("parses an integer string", () => {
    expect(parseDurationSeconds("42")).toBe(42);
  });
  it("returns null for empty/invalid", () => {
    expect(parseDurationSeconds("")).toBeNull();
    expect(parseDurationSeconds(null)).toBeNull();
    expect(parseDurationSeconds("abc")).toBeNull();
  });
});
