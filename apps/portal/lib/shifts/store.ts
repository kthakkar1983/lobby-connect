import type { createAdminClient } from "@/lib/supabase/admin";
import { SESSION_MAX_MS } from "@lc/shared";
import { classifyShiftEnd } from "@/lib/shifts/lifecycle";

type Admin = ReturnType<typeof createAdminClient>;

/** Open a shift iff none is open. The partial unique index makes a race a 23505
 *  we deliberately swallow (a shift is already open — the desired end state). */
export async function openShift(admin: Admin, userId: string, operatorId: string): Promise<void> {
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
  const { data: open } = await admin
    .from("shifts")
    .select("id, started_at")
    .eq("user_id", userId)
    .is("ended_at", null)
    .maybeSingle();
  if (!open) return;

  await admin
    .from("shift_breaks")
    .update({ ended_at: endedAtIso })
    .eq("shift_id", open.id)
    .is("ended_at", null);

  const reason =
    kind === "manual" ? "manual" : classifyShiftEnd(open.started_at, endedAtIso, SESSION_MAX_MS);

  await admin
    .from("shifts")
    .update({ ended_at: endedAtIso, ended_reason: reason })
    .eq("id", open.id)
    .is("ended_at", null);
}

export async function openBreak(admin: Admin, userId: string): Promise<void> {
  const { data: open } = await admin
    .from("shifts")
    .select("id")
    .eq("user_id", userId)
    .is("ended_at", null)
    .maybeSingle();
  if (!open) return;
  const { error } = await admin.from("shift_breaks").insert({ shift_id: open.id });
  if (error && error.code !== "23505") console.error("[shifts] openBreak failed", error);
}

export async function closeOpenBreak(admin: Admin, userId: string, endedAtIso: string): Promise<void> {
  const { data: open } = await admin
    .from("shifts")
    .select("id")
    .eq("user_id", userId)
    .is("ended_at", null)
    .maybeSingle();
  if (!open) return;
  await admin
    .from("shift_breaks")
    .update({ ended_at: endedAtIso })
    .eq("shift_id", open.id)
    .is("ended_at", null);
}
