// Task 19 (shift-tracking plan): the admin timesheet page. Server Component —
// resolves the actor + date range, then delegates to the tested `lib/shifts/query`
// orchestrator for the actual data assembly. Read-only in this task; editing
// (Task 20) wires dialogs into `ShiftsTable` without touching this fetch.
//
// Mirrors `admin/audit/page.tsx`'s shape: `shifts` is read via the RLS-scoped
// `supabase` client (the admin SELECT policy from migration 0021), while the
// batched profiles/calls/audit context inside `fetchTimesheet` uses the
// service-role `admin` client (a plain admin's own RLS doesn't necessarily
// cover every other agent's calls/audit rows).
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

  return (
    <div className="flex w-full max-w-6xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold text-foreground">Shifts</h1>
      <ShiftsTable rows={rows} range={range} />
    </div>
  );
}
