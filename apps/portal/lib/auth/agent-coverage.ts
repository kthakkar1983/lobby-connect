import "server-only";
import { cache } from "react";
import { createServerClient } from "@/lib/supabase/server";

export type AgentCoverage = {
  ids: string[];
  properties: { id: string; name: string; timezone: string }[];
};

// Active assignments -> covered properties for one agent, memoized per render so
// the agent layout and the agent page share a single pair of reads.
export const getAgentCoverage = cache(async (agentId: string): Promise<AgentCoverage> => {
  const supabase = await createServerClient();
  const { data: assignments } = await supabase
    .from("property_assignments")
    .select("property_id")
    .eq("primary_agent_id", agentId)
    .is("effective_until", null);
  const ids = (assignments ?? []).map((a) => a.property_id);
  if (ids.length === 0) return { ids: [], properties: [] };
  const { data: props } = await supabase
    .from("properties")
    .select("id, name, timezone")
    .in("id", ids)
    .order("name");
  return { ids, properties: (props ?? []) as AgentCoverage["properties"] };
});
