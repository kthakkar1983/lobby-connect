import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/owner/status-pill";
import { CallDetailBody, type CallDetail } from "@/components/call/call-detail-body";

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
      "id, property_id, channel, state, caller_number, room_number, ring_started_at, duration_seconds, handled_by_user_id, notes, recording_url",
    )
    .eq("id", id)
    .maybeSingle();

  if (!call) notFound();

  const { data: property } = await supabase
    .from("properties")
    .select("name, timezone")
    .eq("id", call.property_id)
    .maybeSingle();

  let handlerName = "Unanswered";
  if (call.handled_by_user_id) {
    const { data: h } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", call.handled_by_user_id)
      .maybeSingle();
    handlerName = h?.full_name ?? "—";
  }

  const { data: incident } = await supabase
    .from("incidents")
    .select("id")
    .eq("call_id", id)
    .maybeSingle();

  const detail: CallDetail = {
    id: call.id,
    channel: call.channel,
    state: call.state,
    caller_number: call.caller_number,
    room_number: call.room_number,
    ring_started_at: call.ring_started_at,
    duration_seconds: call.duration_seconds,
    notes: call.notes,
    recording_url: call.recording_url,
    propertyName: property?.name ?? "—",
    timeZone: property?.timezone ?? "UTC",
    handlerName,
  };

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

      <CallDetailBody data={detail} incidentHref={incident?.id ? `/owner/incidents/${incident.id}` : null} />
    </div>
  );
}
