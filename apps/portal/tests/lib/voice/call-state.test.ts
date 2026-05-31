import { describe, it, expect } from "vitest";

import { canAnswer } from "@/lib/voice/call-state";

describe("canAnswer", () => {
  it("allows answering only a RINGING call", () => {
    expect(canAnswer("RINGING")).toBe(true);
  });

  it("rejects answering an already-progressing or finished call", () => {
    for (const s of ["IN_PROGRESS", "COMPLETED", "NO_ANSWER", "FAILED"]) {
      expect(canAnswer(s)).toBe(false);
    }
  });
});
