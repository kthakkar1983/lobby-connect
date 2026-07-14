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

  it("masks any card-shaped 13-19 digit run, even one that fails Luhn", () => {
    // Aggressive posture (spec §6): real cards ALWAYS pass Luhn, but a
    // fat-fingered real card (or a card-shaped test number) fails it — mask
    // those too so a near-complete PAN can never leave in cleartext.
    expect(redactCardNumbers("1234 5678 9012 3456")).toBe(MASK); // 16 digits, fails Luhn
    expect(redactCardNumbers("4111 1111 1111 1234")).toBe(MASK); // the smoke-test number
    expect(redactCardNumbers("4111111111111234")).toBe(MASK);    // same, no separators
    expect(redactCardNumbers("my card 4111 1111 1111 1234 thanks")).toBe(`my card ${MASK} thanks`);
  });

  it("also masks legit 13-15 digit runs (accepted false-positive, recoverable on live video)", () => {
    // The cost of dropping the Luhn gate: a genuine long numeric string a guest
    // might type also gets masked. Acceptable in this speech-failure exception
    // path — the guest is on live video and can read it aloud.
    expect(redactCardNumbers("011 44 20 7946 0958")).toBe(MASK); // 15-digit intl phone
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
      "order 1234 5678 9012", // 12 digits (<13) — must NOT mask
    ]) {
      expect(redactCardNumbers(s)).toBe(s);
    }
  });
});
