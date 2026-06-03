import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Phone } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  incidentStatusLabel,
  incidentStatusBadgeVariant,
  formatCallTime,
} from "@/lib/owner/format";

function Field({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

export default async function OwnerIncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireRole("OWNER");
  const supabase = await createServerClient();

  const { data: incident } = await supabase
    .from("incidents")
    .select(
      "id, property_id, status, dispatched_to, call_id, notes, created_at, resolved_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!incident) notFound();

  const { data: property } = await supabase
    .from("properties")
    .select("name, timezone")
    .eq("id", incident.property_id)
    .maybeSingle();
  const tz = property?.timezone ?? "UTC";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Link
        href="/owner/incidents"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Incidents
      </Link>

      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-foreground">
          911 Emergency
        </h1>
        <Badge variant={incidentStatusBadgeVariant(incident.status)}>
          {incidentStatusLabel(incident.status)}
        </Badge>
      </div>

      <section className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-5">
        <Field label="Property" value={property?.name ?? "—"} />
        <Field label="Dispatched to" value={incident.dispatched_to} />
        <Field label="Triggered" value={formatCallTime(incident.created_at, tz)} />
        <Field
          label="Resolved"
          value={
            incident.resolved_at
              ? formatCallTime(incident.resolved_at, tz)
              : "Not resolved"
          }
        />
      </section>

      {incident.call_id && (
        <Link
          href={`/owner/calls/${incident.call_id}` as never}
          className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm font-medium text-foreground hover:border-primary/40"
        >
          <Phone className="h-4 w-4" aria-hidden="true" /> View the originating
          call
        </Link>
      )}

      {incident.notes && (
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-medium text-foreground">Notes</h2>
          <p className="whitespace-pre-wrap text-sm text-foreground">
            {incident.notes}
          </p>
        </section>
      )}
    </div>
  );
}
