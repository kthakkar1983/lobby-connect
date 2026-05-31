import type { Role } from "@lc/shared";

import { toTwilioIdentity } from "@/lib/voice/identity";

/**
 * Call-takers (AGENT, ADMIN) get a deterministic Twilio identity at creation.
 * OWNER never takes calls, so it gets null (encodes "cannot receive calls").
 */
export function identityForRole(role: Role, userId: string): string | null {
  if (role === "OWNER") return null;
  return toTwilioIdentity(userId);
}
