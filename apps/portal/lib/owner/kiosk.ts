import { validateKioskMessage } from "@/lib/properties/validate";

export const KIOSK_FIELDS = [
  "kiosk_welcome_heading",
  "kiosk_welcome_message",
  "kiosk_checkin_time",
  "kiosk_checkout_time",
  "kiosk_wifi_network",
  "kiosk_wifi_password",
  "kiosk_breakfast_hours",
  "kiosk_apology_message",
] as const;

export type KioskContentInput = Record<(typeof KIOSK_FIELDS)[number], string>;

const SHORT_MAX = 80;

function validateShort(label: string, value: string): string | null {
  if (value.trim().length > SHORT_MAX) {
    return `${label} must be ${SHORT_MAX} characters or fewer.`;
  }
  return null;
}

export function validateKioskFields(input: KioskContentInput): string | null {
  return (
    validateShort("Welcome heading", input.kiosk_welcome_heading) ??
    validateKioskMessage(input.kiosk_welcome_message) ??
    validateShort("Check-in time", input.kiosk_checkin_time) ??
    validateShort("Check-out time", input.kiosk_checkout_time) ??
    validateShort("Wi-Fi network", input.kiosk_wifi_network) ??
    validateShort("Wi-Fi password", input.kiosk_wifi_password) ??
    validateShort("Breakfast hours", input.kiosk_breakfast_hours) ??
    validateKioskMessage(input.kiosk_apology_message)
  );
}

export const KIOSK_CTA_STYLES = ["warm", "accent", "classic"] as const;
export type KioskCtaStyle = (typeof KIOSK_CTA_STYLES)[number];

export function validateCtaStyle(value: string): string | null {
  return (KIOSK_CTA_STYLES as readonly string[]).includes(value)
    ? null
    : "Choose a valid kiosk appearance.";
}
