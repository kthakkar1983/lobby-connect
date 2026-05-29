import { describe, expect, it } from "vitest";

describe("validateAgentId", () => {
  it("accepts a valid uuid", async () => {
    const { validateAgentId } = await import("@/lib/assignments/validate");
    expect(validateAgentId("00000000-0000-0000-0000-0000000000b3")).toBeNull();
  });

  it("rejects an empty / whitespace-only string", async () => {
    const { validateAgentId } = await import("@/lib/assignments/validate");
    expect(validateAgentId("   ")).toBe("Choose an agent.");
  });

  it("rejects a non-uuid string", async () => {
    const { validateAgentId } = await import("@/lib/assignments/validate");
    expect(validateAgentId("not-a-uuid")).toBe("Choose a valid agent.");
  });
});
