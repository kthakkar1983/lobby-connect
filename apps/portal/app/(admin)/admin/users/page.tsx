import { createServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { UsersTable } from "./users-table";
import { effectivePresence, roleHasPresence } from "@/lib/voice/presence";

export default async function UsersPage() {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();

  const { data: users, error } = await supabase
    .from("profiles")
    .select(
      "id, full_name, email, role, status, active, last_seen_at, created_at, must_change_password"
    )
    .eq("operator_id", actor.operator_id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load users: ${error.message}`);
  }

  // Show effective (staleness-aware) presence: a stale heartbeat reads OFFLINE even
  // if the status column still says AVAILABLE (the OFFLINE sweep is only daily). This
  // matches the admin dashboard + call routing; without it the users list showed a
  // stale "AVAILABLE" that disagreed with the properties board. OWNERs have no
  // softphone and never heartbeat, so leave their stored status untouched — the table
  // renders "—" for them (see roleHasPresence) instead of a misleading OFFLINE.
  const now = Date.now();
  const usersWithPresence = (users ?? []).map((u) => ({
    ...u,
    status: roleHasPresence(u.role)
      ? effectivePresence(u.status, u.last_seen_at, now)
      : u.status,
  }));

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

      <UsersTable users={usersWithPresence} actorId={actor.id} />
    </div>
  );
}
