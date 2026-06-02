/**
 * The number to dial for an emergency. Defaults to the real 911.
 *
 * SAFETY: set EMERGENCY_DIAL_NUMBER=933 for ALL dev/test/pilot work. 933 is the
 * E911 address-readback test number — it never reaches a PSAP and never
 * dispatches responders. Only production should ever resolve to "911".
 */
export function getEmergencyDialNumber(): string {
  const v = process.env.EMERGENCY_DIAL_NUMBER?.trim();
  return v && v.length > 0 ? v : "911";
}

/**
 * The caller ID for the emergency leg. MUST be a number with a registered
 * emergency address so the PSAP routing + address display are correct. Uses the
 * property's routing DID, falling back to the configured Twilio number (same
 * number for the single-tenant pilot).
 */
export function getEmergencyCallerId(
  property: { routing_did: string | null },
  fallbackNumber: string,
): string {
  return property.routing_did ?? fallbackNumber;
}
