import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  canAnswer,
  ACTIVE_CALL_STATES,
  finalizeCallPayload,
  claimCall,
  resolveFinalState,
} from "@/lib/voice/call-state";

describe("canAnswer", () => {
  it("allows answering only a RINGING call", () => {
    expect(canAnswer("RINGING")).toBe(true);
  });

  it("rejects answering an already-progressing or finished call", () => {
    for (const s of ["IN_PROGRESS", "COMPLETED", "NO_ANSWER", "FAILED"]) {
      expect(canAnswer(s)).toBe(false);
    }
  });
});

describe("ACTIVE_CALL_STATES", () => {
  it("contains exactly RINGING and IN_PROGRESS", () => {
    expect(ACTIVE_CALL_STATES).toHaveLength(2);
    expect(ACTIVE_CALL_STATES).toContain("RINGING");
    expect(ACTIVE_CALL_STATES).toContain("IN_PROGRESS");
  });
});

describe("finalizeCallPayload", () => {
  const answeredAt = "2026-06-11T10:00:00.000Z";
  const endedAt = new Date("2026-06-11T10:01:30.000Z");

  it("returns correct shape with duration_seconds for a COMPLETED call", () => {
    const payload = finalizeCallPayload("COMPLETED", answeredAt, endedAt);
    expect(payload.state).toBe("COMPLETED");
    expect(payload.ended_at).toBe(endedAt.toISOString());
    // 90 seconds between answeredAt and endedAt
    expect(payload.duration_seconds).toBe(90);
  });

  it("returns null duration_seconds when answeredAt is null (call never answered)", () => {
    const payload = finalizeCallPayload("NO_ANSWER", null, endedAt);
    expect(payload.state).toBe("NO_ANSWER");
    expect(payload.ended_at).toBe(endedAt.toISOString());
    expect(payload.duration_seconds).toBeNull();
  });

  it("returns the requested terminal state (FAILED)", () => {
    const payload = finalizeCallPayload("FAILED", null, endedAt);
    expect(payload.state).toBe("FAILED");
  });
});

describe("resolveFinalState", () => {
  // Unanswered call: the kiosk reason maps straight through.
  it("maps an unanswered call's reason directly", () => {
    expect(resolveFinalState("no-answer", false)).toBe("NO_ANSWER");
    expect(resolveFinalState("cancelled", false)).toBe("NO_ANSWER");
    expect(resolveFinalState("completed", false)).toBe("COMPLETED");
    expect(resolveFinalState("failed", false)).toBe("FAILED");
  });

  it("defaults an unknown/missing reason to COMPLETED", () => {
    expect(resolveFinalState(undefined, false)).toBe("COMPLETED");
    expect(resolveFinalState("weird", false)).toBe("COMPLETED");
  });

  // The invariant: a call that was ANSWERED can never be NO_ANSWER. A concurrent
  // accept (both rung browsers accepted) or a guest tapping End on a connected
  // call makes the kiosk report cancelled/no-answer for an already-claimed call;
  // that connected-then-ended call is COMPLETED, not a missed call.
  it("never downgrades an answered call to NO_ANSWER", () => {
    expect(resolveFinalState("cancelled", true)).toBe("COMPLETED");
    expect(resolveFinalState("no-answer", true)).toBe("COMPLETED");
  });

  it("keeps a genuine terminal outcome on an answered call", () => {
    expect(resolveFinalState("completed", true)).toBe("COMPLETED");
    // A real mid-call failure stays FAILED — the guard is specifically about NO_ANSWER.
    expect(resolveFinalState("failed", true)).toBe("FAILED");
  });
});

describe("claimCall", () => {
  it("returns true when the UPDATE claims the row (winner)", async () => {
    const selectSpy = vi.fn().mockResolvedValue({ data: [{ id: "call-1" }], error: null });
    const admin = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: selectSpy,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const result = await claimCall(admin, "call-1", "user-1");
    expect(result).toBe(true);
  });

  it("returns false when the UPDATE claims zero rows (loser — concurrent accept won)", async () => {
    const selectSpy = vi.fn().mockResolvedValue({ data: [], error: null });
    const admin = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: selectSpy,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const result = await claimCall(admin, "call-1", "user-1");
    expect(result).toBe(false);
  });

  it("returns false when data is null (DB error)", async () => {
    const selectSpy = vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } });
    const admin = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: selectSpy,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const result = await claimCall(admin, "call-1", "user-1");
    expect(result).toBe(false);
  });
});
