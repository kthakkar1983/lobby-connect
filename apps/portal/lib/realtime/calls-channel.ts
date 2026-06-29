// Isomorphic (client + server): the topic + event name shared by the broadcast
// publisher (server) and the IncomingVideoBanner subscriber (client). NO
// `server-only` here — the client imports it.

/** Broadcast event carrying a content-free "refetch your calls" nudge. */
export const CALLS_CHANGED_EVENT = "calls-changed";

/**
 * Private Realtime channel topic for one operator's call-change nudges. The
 * operator id is the second colon segment so the `realtime.messages` RLS policy
 * can authorize via `split_part(realtime.topic(), ':', 2)::uuid`. The decision-#6
 * multi-tenant seam: one operator in v1, correct for many.
 */
export function operatorCallsChannelTopic(operatorId: string): string {
  return `operator:${operatorId}:calls`;
}
