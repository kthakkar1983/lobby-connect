import { describe, it, expect } from "vitest";

import { toTwilioIdentity } from "@/lib/voice/identity";

describe("toTwilioIdentity", () => {
  it("prefixes lc_ and strips dashes from the uuid", () => {
    expect(toTwilioIdentity("00000000-0000-0000-0000-0000000000b3")).toBe(
      "lc_000000000000000000000000000000b3",
    );
  });

  it("is deterministic", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect(toTwilioIdentity(id)).toBe(toTwilioIdentity(id));
  });
});
