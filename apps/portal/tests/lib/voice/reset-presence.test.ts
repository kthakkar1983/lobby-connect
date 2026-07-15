import { describe, it, expect, vi } from "vitest";
import { resetPresenceAfterCall, ACTIVE_CALL_STATES } from "@/lib/voice/call-state";

// Ownership-aware reset: before flipping profiles ON_CALL -> AVAILABLE it asks
// `calls` whether this agent still has ANOTHER live call, and only resets when
// there is none. The mock routes by table so both the calls read and the
// profiles write are independently observable.
function makeAdmin(otherActiveCalls: Array<{ id: string }> = []) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profiles: Record<string, any> = {};
  profiles.update = vi.fn(() => profiles);
  profiles.eq = vi.fn(() => profiles);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calls: Record<string, any> = {};
  calls.select = vi.fn(() => calls);
  calls.eq = vi.fn(() => calls);
  calls.in = vi.fn(() => calls);
  calls.limit = vi.fn(() => Promise.resolve({ data: otherActiveCalls }));

  const from = vi.fn((table: string) => (table === "profiles" ? profiles : calls));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, profiles, calls };
}

describe("resetPresenceAfterCall", () => {
  it("flips ON_CALL -> AVAILABLE when the agent has no other live call, guarded so it never clobbers AWAY/BREAK/OFFLINE", async () => {
    const { client, profiles } = makeAdmin([]);
    await resetPresenceAfterCall(client, "user-1");
    expect(profiles.update).toHaveBeenCalledWith({ status: "AVAILABLE" });
    expect(profiles.eq).toHaveBeenCalledWith("id", "user-1");
    expect(profiles.eq).toHaveBeenCalledWith("status", "ON_CALL");
  });

  it("checks calls for this agent's OTHER live calls (handled_by + active states)", async () => {
    const { client, calls } = makeAdmin([]);
    await resetPresenceAfterCall(client, "user-1");
    expect(calls.eq).toHaveBeenCalledWith("handled_by_user_id", "user-1");
    expect(calls.in).toHaveBeenCalledWith("state", ACTIVE_CALL_STATES);
  });

  it("does NOT reset when the agent still has another live call (stays ON_CALL)", async () => {
    const { client, profiles } = makeAdmin([{ id: "other-live-call" }]);
    await resetPresenceAfterCall(client, "user-1");
    expect(profiles.update).not.toHaveBeenCalled();
  });

  it("no-ops for a null user (never touches the DB)", async () => {
    const { client, profiles, calls } = makeAdmin();
    await resetPresenceAfterCall(client, null);
    expect(profiles.update).not.toHaveBeenCalled();
    expect(calls.select).not.toHaveBeenCalled();
  });
});
