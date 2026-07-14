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
});
