import { describe, expect, it } from "vitest";
import { mapSignInError, validateSignInInput } from "@/lib/auth/sign-in-errors";

describe("validateSignInInput", () => {
  it("requires both fields with one combined message", () => {
    expect(validateSignInInput("", "")).toBe("Email and password are required.");
    expect(validateSignInInput("user@example.com", "")).toBe(
      "Email and password are required.",
    );
    expect(validateSignInInput("", "secret")).toBe(
      "Email and password are required.",
    );
    expect(validateSignInInput("   ", "secret")).toBe(
      "Email and password are required.",
    );
  });

  it("rejects a malformed or incomplete email", () => {
    expect(validateSignInInput("user", "secret")).toBe(
      "Enter a valid email address.",
    );
    expect(validateSignInInput("user@", "secret")).toBe(
      "Enter a valid email address.",
    );
    expect(validateSignInInput("user@example", "secret")).toBe(
      "Enter a valid email address.",
    );
  });

  it("passes well-formed input", () => {
    expect(validateSignInInput("user@example.com", "secret")).toBeNull();
  });
});

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
