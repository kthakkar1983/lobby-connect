import { describe, expect, it } from "vitest";
import { mapSignInError } from "@/lib/auth/sign-in-errors";

describe("mapSignInError", () => {
  it("maps a 429 status to a rate-limit message", () => {
    expect(mapSignInError({ status: 429 })).toBe(
      "Too many attempts. Please wait a few minutes and try again.",
    );
  });

  it("maps over_request_rate_limit code to the rate-limit message", () => {
    expect(mapSignInError({ code: "over_request_rate_limit" })).toBe(
      "Too many attempts. Please wait a few minutes and try again.",
    );
  });

  it("maps email_not_confirmed to a setup message", () => {
    expect(mapSignInError({ code: "email_not_confirmed", status: 400 })).toBe(
      "Your account isn't fully set up yet. Please contact your administrator.",
    );
  });

  it("defaults invalid_credentials (and missing code) to the credentials message", () => {
    expect(mapSignInError({ code: "invalid_credentials", status: 400 })).toBe(
      "Invalid email or password.",
    );
    expect(mapSignInError({ status: 400 })).toBe("Invalid email or password.");
    expect(mapSignInError({})).toBe("Invalid email or password.");
  });
});
