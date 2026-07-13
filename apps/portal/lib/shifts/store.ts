import type { createAdminClient } from "@/lib/supabase/admin";
import { SESSION_MAX_MS } from "@lc/shared";
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
