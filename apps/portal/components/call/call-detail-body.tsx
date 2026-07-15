import Link from "next/link";
import { Siren } from "lucide-react";
import type { Route } from "next";
import type { CallState, CallDirection } from "@lc/shared";
import { SectionCard } from "@/components/owner/section-card";
import { formatCallTime, formatDuration } from "@/lib/owner/format";

export type CallDetail = {
  readonly id: string;
  readonly channel: string; // "AUDIO" | "VIDEO"
  readonly state: CallState;
  readonly direction: CallDirection;
  readonly caller_number: string | null;
  readonly room_number: string | null;
  readonly ring_started_at: string;
  readonly duration_seconds: number | null;
  readonly notes: string | null;
  readonly recording_url: string | null;
  readonly propertyName: string;
  readonly timeZone: string;
  readonly handlerName: string; // resolved name, or "Unanswered" / "—"
};

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-label text-[10px] uppercase tracking-[0.06em] text-text-muted">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

export function CallDetailBody({
  data,
  incidentHref,
}: {
  readonly data: CallDetail;
  readonly incidentHref?: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      {incidentHref && (
        <Link
          href={incidentHref as Route}
          className="flex items-center gap-2 rounded-card border border-attention/40 bg-attention/10 p-4 text-sm font-medium text-attention-text hover:bg-attention/15"
        >
          <Siren className="size-4" aria-hidden="true" /> Emergency — view incident
        </Link>
      )}

      <SectionCard title="Call">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Property" value={data.propertyName} />
          <Field label="Handled by" value={data.handlerName} />
          <Field label="Started" value={formatCallTime(data.ring_started_at, data.timeZone)} />
          <Field label="Duration" value={formatDuration(data.duration_seconds)} />
          <Field label="Caller" value={data.caller_number ?? "—"} />
          <Field label="Room" value={data.room_number ?? "—"} />
        </div>
      </SectionCard>

      {data.notes && (
        <SectionCard title="Notes">
          <p className="whitespace-pre-wrap text-sm text-foreground">{data.notes}</p>
        </SectionCard>
      )}

      {/* Recording seam: dark until call recording ships. Do not add an iframe sandbox. */}
      {data.recording_url && (
        <SectionCard title="Recording">
          <audio controls src={data.recording_url} className="w-full">
            <track kind="captions" />
          </audio>
        </SectionCard>
      )}
    </div>
  );
}
