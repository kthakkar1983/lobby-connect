import { describe, expect, it } from "vitest";
import { SHARED_PACKAGE_VERSION, isSemver } from "@lc/shared";

describe("portal smoke", () => {
  it("imports @lc/shared", () => {
    expect(isSemver(SHARED_PACKAGE_VERSION)).toBe(true);
  });
});
