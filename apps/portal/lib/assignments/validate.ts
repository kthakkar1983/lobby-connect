// Input guard for the primary-agent selection. The dropdown is RLS-scoped, so
// this is a cheap shape check; the action additionally calls assertValidAgent
// to confirm role + operator + active server-side.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateAgentId(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return "Choose an agent.";
  if (!UUID_RE.test(trimmed)) return "Choose a valid agent.";
  return null;
}
