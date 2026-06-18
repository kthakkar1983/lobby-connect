import type { CallState, CallChannel } from "@lc/shared";

export type Outcome = "answered" | "missed" | "failed";

const OUTCOME_STATES: Record<Outcome, CallState[]> = {
  answered: ["COMPLETED"],
  missed: ["NO_ANSWER"],
  failed: ["FAILED"],
};

/** Narrow a raw query param to a known outcome, else null. */
export function parseOutcome(raw: string | undefined | null): Outcome | null {
  return raw === "answered" || raw === "missed" || raw === "failed" ? raw : null;
}

/** The terminal call state(s) a given outcome filters to. */
export function statesForOutcome(outcome: Outcome): CallState[] {
  return OUTCOME_STATES[outcome];
}

export type CallFilterParams = {
  readonly property?: string | null;
  readonly channel?: CallChannel | null;
  readonly outcome?: Outcome | null;
  readonly before?: string | null;
};

/**
 * Build a Calls href for `basePath` from a full param set. Filter pills pass the
 * desired params with `before` omitted (changing a filter restarts pagination);
 * the pager passes the current filters plus a `before` cursor.
 */
export function buildCallsHref(basePath: string, params: CallFilterParams): string {
  const sp = new URLSearchParams();
  if (params.property) sp.set("property", params.property);
  if (params.channel) sp.set("channel", params.channel);
  if (params.outcome) sp.set("outcome", params.outcome);
  if (params.before) sp.set("before", params.before);
  // URLSearchParams encodes ~ as %7E; restore it so cursor tokens read cleanly
  const qs = sp.toString().replace(/%7E/gi, "~");
  return `${basePath}${qs ? `?${qs}` : ""}`;
}
