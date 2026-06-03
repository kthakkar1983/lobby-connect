import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Siren } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  callStateLabel,
  callStateBadgeVariant,
  formatCallTime,
  formatDuration,
} from "@/lib/owner/format";

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

export default async function OwnerCallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireRole("OWNER");
  const supabase = await createServerClient();

  const { data: call } = await supabase
    .from("calls")
    .select(
      "id, property_id, channel, state, caller_number, room_number, ring_started_at, answered_at, ended_at, duration_seconds, handled_by_user_id, notes, recording_url",
    )
    .eq("id", id)
    .maybeSingle();

  if (!call) notFound();

  const { data: property } = await supabase
    .from("properties")
    .select("name, timezone")
    .eq("id", call.property_id)
    .maybeSingle();
  const tz = property?.timezone ?? "UTC";

  let handler = "Unanswered";
  if (call.handled_by_user_id) {
    const { data: h } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", call.handled_by_user_id)
      .maybeSingle();
    handler = h?.full_name ?? "—";
  }

  const { data: incident } = await supabase
    .from("incidents")
    .select("id")
    .eq("call_id", id)
    .maybeSingle();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Link
        href="/owner/calls"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Calls
      </Link>

      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-foreground">
          {call.channel === "VIDEO" ? "Video call" : "Phone call"}
        </h1>
        <Badge variant={callStateBadgeVariant(call.state)}>{callStateLabel(call.state)}</Badge>
      </div>

      {incident && (
        <Link
          href={`/owner/incidents/${incident.id}` as never}
          className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm font-medium text-destructive hover:bg-destructive/10"
        >
          <Siren className="h-4 w-4" aria-hidden="true" /> Emergency — view incident
        </Link>
      )}

      <section className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-5">
        <Field label="Property" value={property?.name ?? "—"} />
        <Field label="Handled by" value={handler} />
        <Field label="Started" value={formatCallTime(call.ring_started_at, tz)} />
        <Field label="Duration" value={formatDuration(call.duration_seconds)} />
        <Field label="Caller" value={call.caller_number ?? "—"} />
        <Field label="Room" value={call.room_number ?? "—"} />
      </section>

      {call.notes && (
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-medium text-foreground">Notes</h2>
          <p className="whitespace-pre-wrap text-sm text-foreground">{call.notes}</p>
        </section>
      )}

      {/* Recording seam: dark until call recording ships. No code change needed when recording is enabled. */}
      {call.recording_url && (
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-medium text-foreground">Recording</h2>
          <audio controls src={call.recording_url} className="w-full">
            <track kind="captions" />
          </audio>
        </section>
      )}
    </div>
  );
}
