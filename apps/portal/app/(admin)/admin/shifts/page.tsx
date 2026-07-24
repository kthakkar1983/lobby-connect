// Task 19 (shift-tracking plan): the admin timesheet page. Server Component —
// resolves the actor + date range, then delegates to the tested `lib/shifts/query`
// orchestrator for the actual data assembly.
//
// Mirrors `admin/audit/page.tsx`'s shape: `shifts` is read via the RLS-scoped
// `supabase` client (the admin SELECT policy from migration 0021), while the
// batched profiles/calls/audit context inside `fetchTimesheet` uses the
// service-role `admin` client (a plain admin's own RLS doesn't necessarily
// cover every other agent's calls/audit rows).
//
// Task 20 adds the shift-taking roster (AGENT/ADMIN profiles in the actor's
// operator) so the "Add shift" dialog can offer a user picker without its own
// fetch — same RLS-scoped `supabase` read `admin/users/page.tsx` uses.
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseTimesheetRange, fetchTimesheet } from "@/lib/shifts/query";
import { ShiftsTable } from "./shifts-table";

export default async function AdminShiftsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const actor = await requireRole("ADMIN");
  const range = parseTimesheetRange(sp);
  const supabase = await createServerClient();
  const admin = createAdminClient();
  const rows = await fetchTimesheet(supabase, admin, actor.operator_id, range);

  const { data: roster, error: rosterError } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("operator_id", actor.operator_id)
    .eq("active", true)
    .in("role", ["AGENT", "ADMIN"])
    .order("full_name", { ascending: true });
  if (rosterError) {
    console.error("[admin/shifts] roster read failed", rosterError);
  }

  return (
    <div className="flex w-full max-w-6xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-foreground">Shifts</h1>
      <ShiftsTable rows={rows} range={range} roster={roster ?? []} />
    </div>
  );
}
