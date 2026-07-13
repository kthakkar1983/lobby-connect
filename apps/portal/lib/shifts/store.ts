import type { createAdminClient } from "@/lib/supabase/admin";
import { SESSION_MAX_MS, MAX_SHIFT_MS } from "@lc/shared";
import { classifyShiftEnd } from "@/lib/shifts/lifecycle";

type Admin = ReturnType<typeof createAdminClient>;

/** Open a FRESH shift (close-then-insert, the assignments temporal-row pattern).
 *  A shift can still be open when go-on-duty fires — a machine that slept or a
 *  tab closed with no final beat leaves it open until the cron reconciles it. If
 *  we just INSERTed, that would hit `shifts_one_open` (23505) and — with the
 *  swallow below — the agent would silently re-enter the OLD shift, merging the
 *  entire off-duty gap into clocked time. So first close any lingering open shift
 *  at the agent's REAL last activity (`priorLastSeenIso`, captured before
 *  go-on-duty overwrote last_seen_at), then insert. A residual 23505 (a genuine
 *  concurrent go-on-duty) is still the desired end state, so stays swallowed. */
export async function openShift(
  admin: Admin,
  userId: string,
  operatorId: string,
  priorLastSeenIso: string | null,
): Promise<void> {
  await closeOpenShiftForUser(
    admin,
    userId,
    priorLastSeenIso ?? new Date().toISOString(),
    "auto",
  );
  const { error } = await admin
    .from("shifts")
    .insert({ user_id: userId, operator_id: operatorId });
  if (error && error.code !== "23505") {
    console.error("[shifts] openShift failed", error);
  }
}

/** Close the user's open shift (and any open break) at endedAtIso. `manual` =
 *  End shift; `auto` = lapse/cron (reason derived from duration). No-op if none open.
 *  The final UPDATE is guarded `.is("ended_at", null)` so the first writer wins. */
export async function closeOpenShiftForUser(
  admin: Admin,
  userId: string,
  endedAtIso: string,
  kind: "manual" | "auto",
): Promise<void> {
  const { data: open, error: openReadError } = await admin
    .from("shifts")
    .select("id, started_at")
    .eq("user_id", userId)
    .is("ended_at", null)
    .maybeSingle();
  // A transient read error is indistinguishable from "no open shift" (both leave
  // `open` falsy), so log it — otherwise the cron backstop could fail silently.
  if (openReadError) {
    console.error("[shifts] closeOpenShiftForUser: open-shift read failed", openReadError);
  }
  if (!open) return;

  const { error: breakCloseError } = await admin
    .from("shift_breaks")
    .update({ ended_at: endedAtIso })
    .eq("shift_id", open.id)
    .is("ended_at", null);
  if (breakCloseError) {
    console.error("[shifts] closeOpenShiftForUser: shift_breaks close failed", breakCloseError);
  }

  const reason =
    kind === "manual" ? "manual" : classifyShiftEnd(open.started_at, endedAtIso, SESSION_MAX_MS);

  const { error: shiftCloseError } = await admin
    .from("shifts")
    .update({ ended_at: endedAtIso, ended_reason: reason })
    .eq("id", open.id)
    .is("ended_at", null);
  if (shiftCloseError) {
    console.error("[shifts] closeOpenShiftForUser: shifts close failed", shiftCloseError);
  }
}

export async function openBreak(admin: Admin, userId: string): Promise<void> {
  const { data: open, error: openReadError } = await admin
    .from("shifts")
    .select("id")
    .eq("user_id", userId)
    .is("ended_at", null)
    .maybeSingle();
  if (openReadError) console.error("[shifts] openBreak: open-shift read failed", openReadError);
  if (!open) return;
  const { error } = await admin.from("shift_breaks").insert({ shift_id: open.id });
  if (error && error.code !== "23505") console.error("[shifts] openBreak failed", error);
}

/**
 * Force-close every open shift that has run past the app-level max-shift cap
 * (`MAX_SHIFT_MS`), regardless of heartbeat staleness. This is the FREE-TIER
 * stand-in for Supabase's 12h session cap (Pro-only, deferred): SHIFT_ABANDON's
 * staleness sweep can never catch a forgotten shift on an AWAKE machine that
 * keeps beating, so this shift-length cap does. Runs AFTER the abandon sweep so a
 * shift that is both stale and over-cap closes at its accurate last_seen_at, not
 * the ceiling. Returns the count of shifts actually capped.
 *
 * FLIP-FIRST ordering (the gate): per over-cap shift we flip the agent OFFLINE
 * FIRST — EXCLUDING a live call (`.neq("status","ON_CALL")`) — and use the
 * matched-rows result to GATE the close. Only if the flip actually took (she was
 * not on a call) do we close the shift + break. An ON_CALL agent is skipped
 * ENTIRELY: her shift stays OPEN, so the next sweep re-caps her once the call
 * ends. This is what avoids stranding her with a CLOSED shift but on-duty
 * raw-status (an unbounded un-clocked-work window that no later sweep could
 * re-catch, since the scan only sees OPEN shifts). The flip is also what stops
 * un-clocked work leaking generally: `canDoWork` is raw-status, so an
 * AVAILABLE-but-shiftless agent would otherwise still be sent work untracked.
 *
 * Close semantics: shift `ended_at` = the CEILING (`started_at + MAX_SHIFT_MS`,
 * NOT "now" — "now" grows with cron cadence and re-introduces the unbounded
 * inflation this exists to stop), reason `capped`. Any open break is closed at
 * `max(break.started_at, ceiling)` — clamped so a break OPENED past the ceiling
 * (a shift that ran past the cap in real time before the daily cron) can't get
 * `ended_at < started_at` (a negative-duration row; no DB CHECK guards it). Every
 * write is first-writer-wins guarded (`.is("ended_at", null)`) / best-effort logged. */
export async function capOverlongShifts(admin: Admin, nowMs: number): Promise<number> {
  const capCutoffIso = new Date(nowMs - MAX_SHIFT_MS).toISOString();
  const { data: overCap, error: scanError } = await admin
    .from("shifts")
    .select("id, user_id, started_at")
    .is("ended_at", null)
    .lt("started_at", capCutoffIso);
  if (scanError) {
    console.error("[shifts] capOverlongShifts: over-cap scan failed", scanError);
    return 0;
  }
  const rows = overCap ?? [];

  const capped = await Promise.all(
    rows.map(async (s) => {
      const ceilingMs = Date.parse(s.started_at) + MAX_SHIFT_MS;
      const ceilingIso = new Date(ceilingMs).toISOString();

      // 1. Flip OFFLINE FIRST, excluding a live call. The matched rows gate the
      //    close: a flip that took 0 rows means she is ON_CALL (or the write
      //    errored) → skip the close so her shift stays OPEN for the next sweep.
      const { data: flipped, error: flipError } = await admin
        .from("profiles")
        .update({ status: "OFFLINE" })
        .eq("id", s.user_id)
        .neq("status", "ON_CALL")
        .select("id");
      if (flipError) {
        console.error("[shifts] capOverlongShifts: OFFLINE flip failed", flipError);
        return false;
      }
      if (!flipped || flipped.length === 0) {
        // ON_CALL → skip entirely; the next sweep re-caps her once the call ends.
        return false;
      }

      // 2. She is now OFFLINE → close any open break, clamped to never predate
      //    its own start (finding 3), then the shift itself.
      const { data: openBreak, error: breakReadError } = await admin
        .from("shift_breaks")
        .select("id, started_at")
        .eq("shift_id", s.id)
        .is("ended_at", null)
        .maybeSingle();
      if (breakReadError) {
        console.error("[shifts] capOverlongShifts: open-break read failed", breakReadError);
      } else if (openBreak) {
        const breakEndIso = new Date(
          Math.max(Date.parse(openBreak.started_at), ceilingMs),
        ).toISOString();
        const { error: breakCloseError } = await admin
          .from("shift_breaks")
          .update({ ended_at: breakEndIso })
          .eq("id", openBreak.id)
          .is("ended_at", null);
        if (breakCloseError) {
          console.error("[shifts] capOverlongShifts: break close failed", breakCloseError);
        }
      }

      const { error: shiftError } = await admin
        .from("shifts")
        .update({ ended_at: ceilingIso, ended_reason: "capped" })
        .eq("id", s.id)
        .is("ended_at", null);
      if (shiftError) {
        console.error("[shifts] capOverlongShifts: shift close failed", shiftError);
      }
      return true;
    }),
  );

  return capped.filter(Boolean).length;
}

export async function closeOpenBreak(admin: Admin, userId: string, endedAtIso: string): Promise<void> {
  const { data: open, error: openReadError } = await admin
    .from("shifts")
    .select("id")
    .eq("user_id", userId)
    .is("ended_at", null)
    .maybeSingle();
  if (openReadError) console.error("[shifts] closeOpenBreak: open-shift read failed", openReadError);
  if (!open) return;
  const { error } = await admin
    .from("shift_breaks")
    .update({ ended_at: endedAtIso })
    .eq("shift_id", open.id)
    .is("ended_at", null);
  if (error) console.error("[shifts] closeOpenBreak failed", error);
}
