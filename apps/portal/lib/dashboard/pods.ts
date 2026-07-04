// apps/portal/lib/dashboard/pods.ts
// Pure pod/fleet helpers for the Phase-3 property-card dashboards (spec §3.1, D7).
import type { ProfileStatus } from "@lc/shared";
import { effectivePresence } from "@/lib/voice/presence";

export interface PodProperty {
  id: string;
  name: string;
  timezone: string;
}

export interface PodAgent {
  id: string;
  full_name: string;
  status: string;
  last_seen_at: string | null;
}

export interface PodGroup {
  agent: PodAgent | null; // null = unassigned trailing group
  properties: PodProperty[];
}

export function groupPodsByAgent(input: {
  properties: PodProperty[];
  assignments: Array<{ property_id: string; primary_agent_id: string }>;
  agents: PodAgent[];
}): PodGroup[] {
  const agentById = new Map(input.agents.map((a) => [a.id, a]));
  const propertyById = new Map(input.properties.map((p) => [p.id, p]));
  const byAgent = new Map<string, PodProperty[]>();
  const assigned = new Set<string>();

  for (const a of input.assignments) {
    const prop = propertyById.get(a.property_id);
    if (!prop) continue; // assignment references a property not in the list — ignore
    assigned.add(prop.id);
    const list = byAgent.get(a.primary_agent_id) ?? [];
    list.push(prop);
    byAgent.set(a.primary_agent_id, list);
  }

  const byName = (a: PodProperty, b: PodProperty) => a.name.localeCompare(b.name);
  const groups: PodGroup[] = [...byAgent.entries()]
    .map(([agentId, properties]) => ({
      agent: agentById.get(agentId) ?? null,
      properties: properties.sort(byName),
    }))
    .sort((a, b) => (a.agent?.full_name ?? "").localeCompare(b.agent?.full_name ?? ""));

  const unassigned = input.properties.filter((p) => !assigned.has(p.id)).sort(byName);
  if (unassigned.length > 0) groups.push({ agent: null, properties: unassigned });
  return groups;
}

export type CardLiveState = "ringing" | "on-hold" | "on-call" | "quiet";

// NOTE: "on-hold" is a dormant seam in Phase 3 — hold is deferred (spec §3.6);
// nothing sets onHold=true yet. Precedence is designed in now so hold drops in later.
export function cardLiveState(s: { ringing: boolean; onHold: boolean; onCall: boolean }): CardLiveState {
  if (s.ringing) return "ringing";
  if (s.onHold) return "on-hold";
  if (s.onCall) return "on-call";
  return "quiet";
}

export type DutyLabel = "On duty" | "On call" | "Away" | "Off duty";

export function dutyLabel(status: string, lastSeenAt: string | null, nowMs: number): DutyLabel {
  const effective = effectivePresence(status as ProfileStatus, lastSeenAt, nowMs);
  if (effective === "AVAILABLE") return "On duty";
  if (effective === "ON_CALL") return "On call";
  if (effective === "AWAY") return "Away";
  return "Off duty"; // OFFLINE, and any stale row effectivePresence already collapses to OFFLINE
}
