import { describe, it, expect } from "vitest";

import { identityForRole } from "@/lib/users/twilio-identity";

describe("identityForRole", () => {
  it("gives AGENT an identity", () => {
    expect(identityForRole("AGENT", "00000000-0000-0000-0000-0000000000b3")).toBe(
      "lc_000000000000000000000000000000b3",
    );
  });

  it("gives ADMIN an identity", () => {
    expect(identityForRole("ADMIN", "11111111-1111-1111-1111-111111111111")).toBe(
      "lc_11111111111111111111111111111111",
    );
  });

  it("gives OWNER no identity (null)", () => {
    expect(identityForRole("OWNER", "22222222-2222-2222-2222-222222222222")).toBeNull();
  });
});
