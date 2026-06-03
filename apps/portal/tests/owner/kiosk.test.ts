import { describe, it, expect } from "vitest";
import {
  validateKioskFields,
  KIOSK_FIELDS,
  type KioskContentInput,
} from "@/lib/owner/kiosk";

function valid(): KioskContentInput {
  return {
    kiosk_welcome_heading: "Welcome",
    kiosk_welcome_message: "How can we help?",
    kiosk_checkin_time: "3:00 PM",
    kiosk_checkout_time: "11:00 AM",
    kiosk_wifi_network: "Hotel-Guest",
    kiosk_wifi_password: "sunshine123",
    kiosk_breakfast_hours: "7-10 AM",
    kiosk_apology_message: "Sorry, no one is available.",
  };
}

describe("KIOSK_FIELDS", () => {
  it("lists the 8 guest-facing kiosk columns", () => {
    expect(KIOSK_FIELDS).toHaveLength(8);
    expect(KIOSK_FIELDS).toContain("kiosk_welcome_heading");
    expect(KIOSK_FIELDS).toContain("kiosk_apology_message");
  });
});

describe("validateKioskFields", () => {
  it("accepts a valid payload", () => {
    expect(validateKioskFields(valid())).toBeNull();
  });

  it("accepts all-empty (every field clears to null)", () => {
    const empty = Object.fromEntries(
      KIOSK_FIELDS.map((f) => [f, ""]),
    ) as KioskContentInput;
    expect(validateKioskFields(empty)).toBeNull();
  });

  it("rejects an over-long welcome message (280 cap)", () => {
    const input = { ...valid(), kiosk_welcome_message: "x".repeat(281) };
    expect(validateKioskFields(input)).toMatch(/280/);
  });

  it("rejects an over-long short field (80 cap)", () => {
    const input = { ...valid(), kiosk_checkin_time: "x".repeat(81) };
    expect(validateKioskFields(input)).toMatch(/80/);
  });
});
