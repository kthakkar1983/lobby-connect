import Link from "next/link";
import { ArrowRight, Building2, Users } from "lucide-react";

export default function AdminOverviewPage() {
  return (
    <div className="flex flex-col gap-6">
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
              <span className="text-sm font-medium text-foreground">
                Users
              </span>
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
    </div>
  );
}
