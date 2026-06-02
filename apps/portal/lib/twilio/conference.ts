import "server-only";
import type twilio from "twilio";

type RestClient = ReturnType<typeof twilio>;

interface ChildLeg {
  sid: string;
  status: string;
}

/** From a parent call's child legs, the SID of the one still in progress. */
export function pickAgentLeg(children: ChildLeg[]): string | null {
  const live = children.find((c) => c.status === "in-progress");
  return live ? live.sid : null;
}

/** Find the agent's live answer leg (the child of the guest's inbound call). */
export async function findAgentLeg(
  client: RestClient,
  parentCallSid: string,
): Promise<string | null> {
  if (!parentCallSid) return null;
  const children = await client.calls.list({ parentCallSid, limit: 20 });
  return pickAgentLeg(children.map((c) => ({ sid: c.sid, status: c.status })));
}

/** Add an emergency leg (911 / 933) to the conference. `to` must be an emergency
 *  number and `from` must be a number with a registered emergency address. */
export async function addEmergencyParticipant(
  client: RestClient,
  conferenceName: string,
  opts: { from: string; to: string },
): Promise<{ callSid: string | null }> {
  const p = await client
    .conferences(conferenceName)
    .participants.create({ from: opts.from, to: opts.to });
  return { callSid: p.callSid ?? null };
}
