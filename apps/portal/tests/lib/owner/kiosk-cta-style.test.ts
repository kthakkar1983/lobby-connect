import { describe, it, expect } from "vitest";
import { KIOSK_CTA_STYLES, validateCtaStyle } from "@/lib/owner/kiosk";

describe("validateCtaStyle", () => {
  it("accepts each known style", () => {
    for (const s of KIOSK_CTA_STYLES) expect(validateCtaStyle(s)).toBeNull();
  });
  it("rejects an unknown style", () => {
    expect(validateCtaStyle("rainbow")).toMatch(/appearance/i);
  });
});
