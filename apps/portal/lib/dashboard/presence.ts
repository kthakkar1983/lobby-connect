import type { ProfileStatus } from "@lc/shared";
import { isStale } from "@/lib/voice/presence";
import { isLivePresence } from "@/lib/owner/format";

export type PresenceRow = {
  readonly status: ProfileStatus;
  readonly last_seen_at: string | null;
};

export function countOnlineAgents(agents: ReadonlyArray<PresenceRow>, now: number): number {
  return agents.filter((a) => isLivePresence(a.status) && !isStale(a.last_seen_at, now)).length;
}
