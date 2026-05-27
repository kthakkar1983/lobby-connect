import { describe, expect, it } from "vitest";
import { SHARED_PACKAGE_VERSION, isSemver } from "../src/version.js";

describe("version", () => {
  it("SHARED_PACKAGE_VERSION is a semver string", () => {
    expect(isSemver(SHARED_PACKAGE_VERSION)).toBe(true);
  });

  it("isSemver rejects non-semver", () => {
    expect(isSemver("not-a-version")).toBe(false);
    expect(isSemver("1.2")).toBe(false);
    expect(isSemver("")).toBe(false);
  });

  it("isSemver accepts pre-release tags", () => {
    expect(isSemver("1.0.0-alpha.1")).toBe(true);
  });
});
