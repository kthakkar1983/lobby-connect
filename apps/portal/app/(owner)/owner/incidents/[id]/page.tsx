import Link from "next/link";
import { notFound } from "next/navigation";
import type { Route } from "next";
import { ChevronLeft, Phone, Siren } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/owner/status-pill";
import { SectionCard } from "@/components/owner/section-card";
import { formatCallTime } from "@/lib/owner/format";
import { cn } from "@/lib/utils";
import { ResolveIncident } from "./resolve-incident";

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-label text-[10px] uppercase tracking-[0.06em] text-text-muted">{label}</span>
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
      "id, property_id, status, dispatched_to, call_id, notes, resolution_note, created_at, resolved_at",
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

  const open = incident.status !== "RESOLVED";
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Link
        href="/owner/incidents"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden="true" /> Incidents
      </Link>

      <div
        className={cn(
          "flex items-center gap-3 rounded-card border p-4",
          open ? "border-attention/40 bg-attention/10" : "border-border bg-card",
        )}
      >
        <Siren className={cn("size-5", open ? "text-attention-text" : "text-text-muted")} aria-hidden="true" />
        <h1 className="font-display text-2xl text-foreground">Emergency</h1>
        <span className="rounded-[5px] bg-destructive/10 px-1.5 py-0.5 font-label text-[11px] font-bold tracking-[0.04em] text-destructive">911</span>
        <StatusPill kind="incident" status={incident.status} />
      </div>

      <ResolveIncident incidentId={incident.id} status={incident.status} />

      <SectionCard title="Incident">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Property" value={property?.name ?? "—"} />
          <Field label="Dispatched to" value={incident.dispatched_to} />
          <Field label="Triggered" value={formatCallTime(incident.created_at, tz)} />
          <Field
            label="Resolved"
            value={incident.resolved_at ? formatCallTime(incident.resolved_at, tz) : "Not resolved"}
          />
        </div>
      </SectionCard>

      {incident.call_id && (
        <Link
          href={`/owner/calls/${incident.call_id}` as Route}
          className="flex items-center gap-2 rounded-card border border-border bg-card p-4 text-sm font-medium text-foreground hover:border-accent/40"
        >
          <Phone className="size-4" aria-hidden="true" /> View the originating call
        </Link>
      )}

      {incident.notes && (
        <SectionCard title="Notes">
          <p className="whitespace-pre-wrap text-sm text-foreground">{incident.notes}</p>
        </SectionCard>
      )}

      {incident.resolution_note && (
        <SectionCard title="Resolution note">
          <p className="whitespace-pre-wrap text-sm text-foreground">{incident.resolution_note}</p>
        </SectionCard>
      )}
    </div>
  );
}
