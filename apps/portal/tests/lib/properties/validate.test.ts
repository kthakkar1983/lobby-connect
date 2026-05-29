import { describe, expect, it } from "vitest";

describe("validatePropertyName", () => {
  it("accepts a normal name", async () => {
    const { validatePropertyName } = await import("@/lib/properties/validate");
    expect(validatePropertyName("Grand Plaza Hotel")).toBeNull();
  });

  it("rejects an empty / whitespace-only string", async () => {
    const { validatePropertyName } = await import("@/lib/properties/validate");
    expect(validatePropertyName("   ")).toBe("Enter a property name.");
  });

  it("rejects names over 120 characters", async () => {
    const { validatePropertyName } = await import("@/lib/properties/validate");
    expect(validatePropertyName("a".repeat(121))).toBe(
      "Property name must be 120 characters or fewer.",
    );
  });
});

describe("validateTimezone", () => {
  it("accepts a curated zone", async () => {
    const { validateTimezone } = await import("@/lib/properties/validate");
    expect(validateTimezone("America/New_York")).toBeNull();
    expect(validateTimezone("Pacific/Honolulu")).toBeNull();
  });

  it("rejects a non-curated zone", async () => {
    const { validateTimezone } = await import("@/lib/properties/validate");
    expect(validateTimezone("Europe/London")).toBe("Choose a valid timezone.");
  });

  it("rejects an empty string", async () => {
    const { validateTimezone } = await import("@/lib/properties/validate");
    expect(validateTimezone("")).toBe("Choose a valid timezone.");
  });
});

describe("validatePhone", () => {
  it("accepts an empty value (optional field)", async () => {
    const { validatePhone } = await import("@/lib/properties/validate");
    expect(validatePhone("")).toBeNull();
    expect(validatePhone("   ")).toBeNull();
  });

  it("accepts an E.164-style number with formatting", async () => {
    const { validatePhone } = await import("@/lib/properties/validate");
    expect(validatePhone("+1 (555) 123-4567")).toBeNull();
  });

  it("rejects letters", async () => {
    const { validatePhone } = await import("@/lib/properties/validate");
    expect(validatePhone("CALL-US")).toBe(
      "Phone number can only contain digits, spaces, and + - ( ) characters.",
    );
  });

  it("rejects values over 32 characters", async () => {
    const { validatePhone } = await import("@/lib/properties/validate");
    expect(validatePhone("1".repeat(33))).toBe(
      "Phone number must be 32 characters or fewer.",
    );
  });
});

describe("validateKioskMessage", () => {
  it("accepts an empty value", async () => {
    const { validateKioskMessage } = await import("@/lib/properties/validate");
    expect(validateKioskMessage("")).toBeNull();
  });

  it("accepts a normal message", async () => {
    const { validateKioskMessage } = await import("@/lib/properties/validate");
    expect(validateKioskMessage("How can we help you today?")).toBeNull();
  });

  it("rejects messages over 280 characters", async () => {
    const { validateKioskMessage } = await import("@/lib/properties/validate");
    expect(validateKioskMessage("x".repeat(281))).toBe(
      "Message must be 280 characters or fewer.",
    );
  });
});
