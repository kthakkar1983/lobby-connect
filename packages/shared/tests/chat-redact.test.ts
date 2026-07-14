import { describe, it, expect } from "vitest";
import { redactCardNumbers, luhnValid } from "../src/chat-redact";

describe("luhnValid", () => {
  it("accepts a valid PAN and rejects a mistyped one", () => {
    expect(luhnValid("4111111111111111")).toBe(true);   // Visa test
    expect(luhnValid("4111111111111112")).toBe(false);
  });
});

describe("redactCardNumbers", () => {
  const MASK = "•••• (card number hidden)";

  it("masks card numbers (with and without separators)", () => {
    expect(redactCardNumbers("my card is 4111111111111111")).toBe(`my card is ${MASK}`);
    expect(redactCardNumbers("4111 1111 1111 1111")).toBe(MASK);
    expect(redactCardNumbers("4111-1111-1111-1111")).toBe(MASK);
    expect(redactCardNumbers("378282246310005 amex")).toBe(`${MASK} amex`); // 15-digit Amex
  });

  it("leaves normal front-desk input untouched", () => {
    for (const s of [
      "1425 Oak Street, Apt 3",   // house number
      "ZIP 94103",                // ZIP-5
      "94103-1425",               // ZIP+4
      "call me at 415 555 1234",  // phone
      "room 237",                 // room
      "reservation 8825519",      // conf number
      "checkout is 07/13/2026",   // date
    ]) {
      expect(redactCardNumbers(s)).toBe(s);
    }
  });

  it("does not mask a 16-digit run that fails Luhn", () => {
    expect(redactCardNumbers("1234 5678 9012 3456")).toBe("1234 5678 9012 3456");
  });

  it("masks separator variants and PANs glued to expiry/CVV (hardened)", () => {
    const MASK = "•••• (card number hidden)";
    // dot-separated card
    expect(redactCardNumbers("4111.1111.1111.1111")).toBe(MASK);
    // PAN glued to an expiry (20 digits total — over the 19 whole-run cap)
    expect(redactCardNumbers("4111 1111 1111 1111 1225")).toBe(MASK);
    // PAN glued to a CVV (19 digits total, whole run fails Luhn)
    expect(redactCardNumbers("4111111111111111 737")).toBe(MASK);
    // leader + PAN (expiry typed first)
    expect(redactCardNumbers("1225 4111 1111 1111 1111")).toBe(MASK);
  });

  it("still leaves non-card numeric input untouched after hardening", () => {
    for (const s of [
      "1425 Oak Street, Apt 3",
      "ZIP 94103",
      "94103-1425",
      "call me at 415 555 1234",
      "room 237",
      "reservation 8825519",
      "checkout is 07/13/2026",
      "1234 5678 9012 3456", // 16 digits, fails Luhn — must NOT mask
      "order 1234 5678 9012", // 12 digits (<13) — must NOT mask
    ]) {
      expect(redactCardNumbers(s)).toBe(s);
    }
  });
});
