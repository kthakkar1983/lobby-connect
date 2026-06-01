import { describe, it, expect } from "vitest";
import { signKioskToken, verifyKioskToken } from "@/lib/kiosk/config-token";

const SECRET = "test-secret-please-rotate";

describe("kiosk config token", () => {
  it("round-trips a property id", () => {
    const token = signKioskToken("prop-1", SECRET);
    expect(verifyKioskToken(token, SECRET)).toEqual({ propertyId: "prop-1" });
  });

  it("rejects a tampered payload", () => {
    const token = signKioskToken("prop-1", SECRET);
    const [, sig] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ p: "prop-2", t: 1 })).toString("base64url")}.${sig}`;
    expect(verifyKioskToken(forged, SECRET)).toBeNull();
  });

  it("rejects a wrong secret", () => {
    const token = signKioskToken("prop-1", SECRET);
    expect(verifyKioskToken(token, "other-secret")).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifyKioskToken("garbage", SECRET)).toBeNull();
    expect(verifyKioskToken("", SECRET)).toBeNull();
  });
});
