import { TIMEZONE_VALUES } from "./timezones";

// Lenient on purpose: accepts E.164 numbers AND Twilio SIDs. Length and the
// allowed character set are the only checks (spec §3.4 / §7).
const PHONE_RE = /^[+()\-\s\d]+$/;

export function validatePropertyName(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return "Enter a property name.";
  if (trimmed.length > 120) {
    return "Property name must be 120 characters or fewer.";
  }
  return null;
}

export function validateTimezone(input: string): string | null {
  if (!TIMEZONE_VALUES.includes(input)) return "Choose a valid timezone.";
  return null;
}

// Shared by routing_did, property_phone_number, after_hours_support_phone.
// Empty is valid — the field clears to null.
export function validatePhone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 32) {
    return "Phone number must be 32 characters or fewer.";
  }
  if (!PHONE_RE.test(trimmed)) {
    return "Phone number can only contain digits, spaces, and + - ( ) characters.";
  }
  return null;
}

export function validateKioskMessage(input: string): string | null {
  if (input.trim().length > 280) {
    return "Message must be 280 characters or fewer.";
  }
  return null;
}
