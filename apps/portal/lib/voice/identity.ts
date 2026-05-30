/**
 * Deterministic Twilio Client identity for a call-taker (AGENT/ADMIN).
 * Same function is reused by Plan 5b's token route so the registered Device
 * identity matches what routing dials. OWNER profiles never get an identity.
 */
export function toTwilioIdentity(userId: string): string {
  return `lc_${userId.replace(/-/g, "")}`;
}
