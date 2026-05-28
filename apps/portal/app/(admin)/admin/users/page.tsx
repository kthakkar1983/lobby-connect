import { createServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { UsersTable } from "./users-table";

export default async function UsersPage() {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();

  const { data: users, error } = await supabase
    .from("profiles")
    .select(
      "id, full_name, email, role, status, active, last_seen_at, created_at",
    )
    .eq("operator_id", actor.operator_id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load users: ${error.message}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Users</h1>
          <p className="mt-1 text-sm text-text-muted">
            Manage admins, agents, and owners in your operator.
          </p>
        </div>
      </header>

      <UsersTable users={users ?? []} actorId={actor.id} />
    </div>
  );
}
