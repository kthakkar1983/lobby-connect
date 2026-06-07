import { describe, it, expect } from "vitest";
import { shouldRefresh } from "@/lib/ui/auto-refresh";

describe("shouldRefresh", () => {
  it("allows the first refresh (lastMs = 0, real epoch now)", () => {
    expect(shouldRefresh(0, Date.now())).toBe(true);
  });

  it("blocks a refresh inside the min gap", () => {
    expect(shouldRefresh(1_000, 4_999)).toBe(false);
  });

  it("allows a refresh once the min gap has elapsed", () => {
    expect(shouldRefresh(1_000, 6_000)).toBe(true);
  });

  it("allows exactly at the boundary", () => {
    expect(shouldRefresh(1_000, 6_000, 5_000)).toBe(true);
  });

  it("honors a custom min gap", () => {
    expect(shouldRefresh(1_000, 1_500, 1_000)).toBe(false);
    expect(shouldRefresh(1_000, 2_000, 1_000)).toBe(true);
  });
});
