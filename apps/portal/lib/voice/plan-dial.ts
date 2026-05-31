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

/**
 * Build the parallel-dial target list: the assigned primary agent (always, if
 * present) followed by accepting admins, deduplicated by twilio_identity so an
 * admin who is BOTH the primary agent and accepting-for-this-property is dialed
 * once. Empty result = nobody reachable.
 */
export function planDial(input: DialInput): DialTarget[] {
  const candidates: DialCandidate[] = [];
  if (input.primaryAgent) candidates.push(input.primaryAgent);
  candidates.push(...input.availableAdmins);

  const seen = new Set<string>();
  const targets: DialTarget[] = [];
  for (const c of candidates) {
    if (!c.twilioIdentity) continue;
    if (seen.has(c.twilioIdentity)) continue;
    seen.add(c.twilioIdentity);
    targets.push({ identity: c.twilioIdentity });
  }
  return targets;
}
