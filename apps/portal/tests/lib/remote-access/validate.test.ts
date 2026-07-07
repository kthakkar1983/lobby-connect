import { describe, expect, it } from "vitest";

describe("validatePeerId", () => {
  it("accepts a normal RustDesk numeric id", async () => {
    const { validatePeerId } = await import("@/lib/remote-access/validate");
    expect(validatePeerId("123456789")).toBeNull();
  });

  it("accepts word chars and hyphens", async () => {
    const { validatePeerId } = await import("@/lib/remote-access/validate");
    expect(validatePeerId("front-desk_1")).toBeNull();
  });

  it("trims surrounding whitespace before validating", async () => {
    const { validatePeerId } = await import("@/lib/remote-access/validate");
    expect(validatePeerId("  123456  ")).toBeNull();
  });

  it("rejects an empty / whitespace-only string", async () => {
    const { validatePeerId } = await import("@/lib/remote-access/validate");
    expect(validatePeerId("   ")).toBe(
      "Enter a valid RustDesk ID (6–24 characters, letters/digits/_/- only).",
    );
  });

  it("rejects an id shorter than 6 characters", async () => {
    const { validatePeerId } = await import("@/lib/remote-access/validate");
    expect(validatePeerId("12345")).toBe(
      "Enter a valid RustDesk ID (6–24 characters, letters/digits/_/- only).",
    );
  });

  it("rejects an id longer than 24 characters", async () => {
    const { validatePeerId } = await import("@/lib/remote-access/validate");
    expect(validatePeerId("1".repeat(25))).toBe(
      "Enter a valid RustDesk ID (6–24 characters, letters/digits/_/- only).",
    );
  });

  it("rejects disallowed characters", async () => {
    const { validatePeerId } = await import("@/lib/remote-access/validate");
    expect(validatePeerId("has spaces!!")).toBe(
      "Enter a valid RustDesk ID (6–24 characters, letters/digits/_/- only).",
    );
  });
});

describe("validateUnattendedPassword", () => {
  it("accepts a normal password", async () => {
    const { validateUnattendedPassword } = await import(
      "@/lib/remote-access/validate"
    );
    expect(validateUnattendedPassword("correcthorsebattery")).toBeNull();
  });

  it("accepts the minimum length (8 chars)", async () => {
    const { validateUnattendedPassword } = await import(
      "@/lib/remote-access/validate"
    );
    expect(validateUnattendedPassword("12345678")).toBeNull();
  });

  it("accepts the maximum length (128 chars)", async () => {
    const { validateUnattendedPassword } = await import(
      "@/lib/remote-access/validate"
    );
    expect(validateUnattendedPassword("a".repeat(128))).toBeNull();
  });

  it("rejects a password shorter than 8 characters", async () => {
    const { validateUnattendedPassword } = await import(
      "@/lib/remote-access/validate"
    );
    expect(validateUnattendedPassword("short")).toBe(
      "Password must be 8–128 characters, with no leading or trailing spaces.",
    );
  });

  it("rejects a password longer than 128 characters", async () => {
    const { validateUnattendedPassword } = await import(
      "@/lib/remote-access/validate"
    );
    expect(validateUnattendedPassword("a".repeat(129))).toBe(
      "Password must be 8–128 characters, with no leading or trailing spaces.",
    );
  });

  it("rejects leading whitespace", async () => {
    const { validateUnattendedPassword } = await import(
      "@/lib/remote-access/validate"
    );
    expect(validateUnattendedPassword(" leadingspace123")).toBe(
      "Password must be 8–128 characters, with no leading or trailing spaces.",
    );
  });

  it("rejects trailing whitespace", async () => {
    const { validateUnattendedPassword } = await import(
      "@/lib/remote-access/validate"
    );
    expect(validateUnattendedPassword("trailingspace123 ")).toBe(
      "Password must be 8–128 characters, with no leading or trailing spaces.",
    );
  });
});
