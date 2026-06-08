import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Siren } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/owner/status-pill";
import { SectionCard } from "@/components/owner/section-card";
import { formatCallTime, formatDuration } from "@/lib/owner/format";

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-label text-[10px] uppercase tracking-[0.06em] text-text-muted">{label}</span>
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Link
        href="/owner/calls"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden="true" /> Calls
      </Link>

      <div className="flex items-center gap-3">
        <h1 className="font-display text-3xl text-foreground">
          {call.channel === "VIDEO" ? "Video call" : "Phone call"}
        </h1>
        <StatusPill kind="call" status={call.state} />
      </div>

      {incident && (
        <Link
          href={`/owner/incidents/${incident.id}` as never}
          className="flex items-center gap-2 rounded-card border border-destructive/40 bg-destructive/5 p-4 text-sm font-medium text-destructive hover:bg-destructive/10"
        >
          <Siren className="size-4" aria-hidden="true" /> Emergency — view incident
        </Link>
      )}

      <SectionCard title="Call">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Property" value={property?.name ?? "—"} />
          <Field label="Handled by" value={handler} />
          <Field label="Started" value={formatCallTime(call.ring_started_at, tz)} />
          <Field label="Duration" value={formatDuration(call.duration_seconds)} />
          <Field label="Caller" value={call.caller_number ?? "—"} />
          <Field label="Room" value={call.room_number ?? "—"} />
        </div>
      </SectionCard>

      {call.notes && (
        <SectionCard title="Notes">
          <p className="whitespace-pre-wrap text-sm text-foreground">{call.notes}</p>
        </SectionCard>
      )}

      {/* Recording seam: dark until call recording ships. No code change needed when recording is enabled. */}
      {call.recording_url && (
        <SectionCard title="Recording">
          <audio controls src={call.recording_url} className="w-full">
            <track kind="captions" />
          </audio>
        </SectionCard>
      )}
    </div>
  );
}
