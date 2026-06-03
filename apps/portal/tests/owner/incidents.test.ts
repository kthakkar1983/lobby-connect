import { describe, it, expect } from "vitest";
import { validateResolutionNote, MAX_RESOLUTION_NOTE } from "@/lib/owner/incidents";

describe("validateResolutionNote", () => {
  it("accepts an empty/absent note (note is optional)", () => {
    expect(validateResolutionNote("")).toBeNull();
    expect(validateResolutionNote(null)).toBeNull();
    expect(validateResolutionNote(undefined)).toBeNull();
  });

  it("accepts a normal note", () => {
    expect(validateResolutionNote("Spoke with guest; all clear.")).toBeNull();
  });

  it("rejects an over-long note", () => {
    expect(validateResolutionNote("x".repeat(MAX_RESOLUTION_NOTE + 1))).toMatch(/1000/);
  });
});
