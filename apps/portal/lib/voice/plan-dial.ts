export interface DialCandidate {
  id: string;
  twilioIdentity: string;
}

export interface DialInput {
  primaryAgent: DialCandidate | null;
  availableAdmins: DialCandidate[];
}

export interface DialTarget {
  identity: string;
}

/** Twilio `<Dial>` rejects 11+ parallel `<Client>` nouns — it breaks the whole
 *  call, not just the 11th. Cap the fan-out and report how many were dropped. */
export const MAX_DIAL_TARGETS = 10;

export interface DialPlan {
  targets: DialTarget[];
  droppedCount: number;
}

/**
 * Build the parallel-dial target list: the assigned primary agent (always, if
 * present) followed by accepting admins, deduplicated by twilio_identity so an
 * admin who is BOTH the primary agent and accepting-for-this-property is dialed
 * once. Empty result = nobody reachable. Capped at MAX_DIAL_TARGETS.
 */
export function planDial(input: DialInput): DialPlan {
  const candidates: DialCandidate[] = [];
  if (input.primaryAgent) candidates.push(input.primaryAgent);
  candidates.push(...input.availableAdmins);

  const seen = new Set<string>();
  const deduped: DialTarget[] = [];
  for (const c of candidates) {
    if (!c.twilioIdentity) continue;
    if (seen.has(c.twilioIdentity)) continue;
    seen.add(c.twilioIdentity);
    deduped.push({ identity: c.twilioIdentity });
  }

  const targets = deduped.slice(0, MAX_DIAL_TARGETS);
  return { targets, droppedCount: deduped.length - targets.length };
}
