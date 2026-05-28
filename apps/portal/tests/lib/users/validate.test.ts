import { describe, expect, it } from "vitest";

describe("validateEmail", () => {
  it("accepts a normal email", async () => {
    const { validateEmail } = await import("@/lib/users/validate");
    expect(validateEmail("admin@example.com")).toBeNull();
  });

  it("rejects an empty string", async () => {
    const { validateEmail } = await import("@/lib/users/validate");
    expect(validateEmail("")).toBe("Enter an email address.");
  });

  it("rejects a malformed value", async () => {
    const { validateEmail } = await import("@/lib/users/validate");
    expect(validateEmail("not-an-email")).toBe("Enter a valid email address.");
  });

  it("trims surrounding whitespace before checking", async () => {
    const { validateEmail } = await import("@/lib/users/validate");
    expect(validateEmail("  admin@example.com  ")).toBeNull();
  });
});

describe("validateFullName", () => {
  it("accepts a normal name", async () => {
    const { validateFullName } = await import("@/lib/users/validate");
    expect(validateFullName("Ada Lovelace")).toBeNull();
  });

  it("rejects an empty string", async () => {
    const { validateFullName } = await import("@/lib/users/validate");
    expect(validateFullName("")).toBe("Enter a full name.");
  });

  it("rejects whitespace-only", async () => {
    const { validateFullName } = await import("@/lib/users/validate");
    expect(validateFullName("   ")).toBe("Enter a full name.");
  });

  it("rejects names over 120 characters", async () => {
    const { validateFullName } = await import("@/lib/users/validate");
    expect(validateFullName("a".repeat(121))).toBe(
      "Full name must be 120 characters or fewer.",
    );
  });
});

describe("validateRole", () => {
  it("accepts ADMIN, AGENT, OWNER", async () => {
    const { validateRole } = await import("@/lib/users/validate");
    expect(validateRole("ADMIN")).toBeNull();
    expect(validateRole("AGENT")).toBeNull();
    expect(validateRole("OWNER")).toBeNull();
  });

  it("rejects anything else", async () => {
    const { validateRole } = await import("@/lib/users/validate");
    expect(validateRole("admin")).toBe("Choose a valid role.");
    expect(validateRole("SUPER")).toBe("Choose a valid role.");
    expect(validateRole("")).toBe("Choose a valid role.");
  });
});

describe("validatePassword", () => {
  it("accepts an 8+ character password", async () => {
    const { validatePassword } = await import("@/lib/users/validate");
    expect(validatePassword("password1")).toBeNull();
  });

  it("rejects short passwords", async () => {
    const { validatePassword } = await import("@/lib/users/validate");
    expect(validatePassword("abc")).toBe(
      "Password must be at least 8 characters.",
    );
  });
});
