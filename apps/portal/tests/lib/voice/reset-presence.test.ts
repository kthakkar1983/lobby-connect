import { describe, it, expect, vi } from "vitest";
import { resetPresenceAfterCall } from "@/lib/voice/call-state";

function makeAdmin() {
  const chain: Record<string, unknown> = {};
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  const from = vi.fn(() => chain);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, chain };
}

describe("resetPresenceAfterCall", () => {
  it("flips ON_CALL -> AVAILABLE, guarded so it never clobbers AWAY/BREAK/OFFLINE", async () => {
    const { client, chain } = makeAdmin();
    await resetPresenceAfterCall(client, "user-1");
    expect(chain.update).toHaveBeenCalledWith({ status: "AVAILABLE" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((chain.eq as any)).toHaveBeenCalledWith("id", "user-1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((chain.eq as any)).toHaveBeenCalledWith("status", "ON_CALL");
  });
  it("no-ops for a null user", async () => {
    const { client, chain } = makeAdmin();
    await resetPresenceAfterCall(client, null);
    expect(chain.update).not.toHaveBeenCalled();
  });
});
