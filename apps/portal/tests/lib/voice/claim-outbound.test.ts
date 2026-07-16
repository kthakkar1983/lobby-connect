import { describe, it, expect, vi } from "vitest";
import { claimOutboundByKiosk } from "@/lib/voice/call-state";

function makeAdmin(rows: unknown[]) {
  const select = vi.fn().mockResolvedValue({ data: rows });
  const chain: Record<string, unknown> = {};
  for (const m of ["update", "eq"]) chain[m] = vi.fn(() => chain);
  chain.select = select;
  const from = vi.fn(() => chain);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, chain };
}

describe("claimOutboundByKiosk", () => {
  it("returns the channel + operator when the RINGING outbound row is claimed, without touching handled_by", async () => {
    const { client, chain } = makeAdmin([{ id: "c1", agora_channel_name: "call_abc", operator_id: "op-1" }]);
    const res = await claimOutboundByKiosk(client, "c1", "prop-1");
    expect(res).toEqual({ channelName: "call_abc", operatorId: "op-1" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateArg = (chain.update as any).mock.calls[0][0];
    expect(updateArg).toMatchObject({ state: "IN_PROGRESS" });
    expect(updateArg).not.toHaveProperty("handled_by_user_id");
  });
  it("returns null when nothing was claimed (already answered/cancelled/timed out)", async () => {
    const { client } = makeAdmin([]);
    expect(await claimOutboundByKiosk(client, "c1", "prop-1")).toBeNull();
  });
});
