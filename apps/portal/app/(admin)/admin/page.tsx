import Link from "next/link";
import { ArrowRight, Building2, PhoneCall, Users } from "lucide-react";
import { createServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { AvailabilityCards, type AvailabilityRow } from "./availability-cards";

export default async function AdminOverviewPage() {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();

  const { data: properties } = await supabase
    .from("properties")
    .select("id, name")
    .eq("operator_id", actor.operator_id)
    .eq("active", true)
    .order("name");

  const { data: availability } = await supabase
    .from("admin_call_availability")
    .select("property_id, accepting_calls")
    .eq("profile_id", actor.id);

  const acceptingByProperty = new Map(
    (availability ?? []).map((a) => [a.property_id, a.accepting_calls]),
  );

  const rows: AvailabilityRow[] = (properties ?? []).map((p) => ({
    propertyId: p.id,
    propertyName: p.name,
    accepting: acceptingByProperty.get(p.id) ?? false,
  }));

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">
          Admin overview
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Manage users, properties, and assignments for your operator.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <Link
          href={"/admin/users" as never}
          className="group flex items-start justify-between rounded-lg border border-border bg-card p-5 transition hover:border-primary"
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Users</span>
            </div>
            <p className="text-xs text-text-muted">
              Invite admins, agents, and owners. Edit roles. Deactivate or
              remove access.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-text-muted transition group-hover:text-primary" />
        </Link>

        <Link
          href={"/admin/properties" as never}
          className="group flex items-start justify-between rounded-lg border border-border bg-card p-5 transition hover:border-primary"
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">
                Properties
              </span>
            </div>
            <p className="text-xs text-text-muted">
              Add and edit the hotels and venues you serve — routing numbers,
              owners, and kiosk messaging.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-text-muted transition group-hover:text-primary" />
        </Link>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <PhoneCall className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-medium text-foreground">
            Your call availability
          </h2>
        </div>
        <p className="text-xs text-text-muted">
          Turn this on for each property you&apos;re covering. When on, you&apos;re
          added to the dial alongside the primary agent when a guest calls.
        </p>
        <AvailabilityCards rows={rows} />
      </section>
    </div>
  );
}
