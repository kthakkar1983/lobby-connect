"use client";

import { useId, useState } from "react";
import { Phone, Video, StickyNote, ChevronDown } from "lucide-react";
import type { CallState } from "@lc/shared";
import { formatDuration, formatTimeOnly, formatCallTime } from "@/lib/owner/format";
import { cn } from "@/lib/utils";

export type RecentCall = {
  readonly id: string;
  readonly channel: string; // "AUDIO" | "VIDEO"
  readonly state: CallState;
  readonly room_number: string | null;
  readonly caller_number: string | null;
  readonly ring_started_at: string;
  readonly duration_seconds: number | null;
  readonly notes: string | null;
  readonly propertyName: string;
  readonly timeZone: string;
  /** Resolved handler name for the operator-wide admin view; omit on the agent
   *  view (every call is the agent's own). */
  readonly handlerName?: string | null;
};

function outcomeDotClass(state: CallState): string {
  if (state === "COMPLETED") return "bg-live"; // answered
  if (state === "NO_ANSWER") return "bg-attention"; // missed
  if (state === "FAILED") return "bg-muted-foreground"; // system failure
  return "bg-live"; // RINGING / IN_PROGRESS — still live
}

function DetailField({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-label text-[10px] uppercase tracking-[0.06em] text-text-muted">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

/**
 * A recent-call row for the agent + admin dashboards. Collapsed it mirrors the
 * old plain list (channel icon · outcome dot · room/property · duration · time)
 * but adds a note icon when the call has notes and a chevron; expanding reveals
 * the call detail (started, duration, room, caller, handler) and the notes text.
 * Parity with the owner portal's CallRow, scoped to dashboard data (no incident
 * link — agent/admin have no incident detail route; v2 seam).
 */
export function RecentCallRow({ call }: { readonly call: RecentCall }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const Icon = call.channel === "VIDEO" ? Video : Phone;
  const hasNotes = Boolean(call.notes?.trim());
  const where = call.room_number ? `Room ${call.room_number}` : "Lobby";

  return (
    <li className="border-b border-border last:border-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 py-2 text-left text-sm transition-colors hover:text-accent-text"
      >
        <Icon
          size={14}
          className="shrink-0 text-text-muted"
          aria-label={call.channel === "VIDEO" ? "Video" : "Phone"}
        />
        <span
          className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", outcomeDotClass(call.state))}
          aria-hidden="true"
        />
        {hasNotes && (
          <StickyNote size={13} className="shrink-0 text-text-muted" role="img" aria-label="Has notes" />
        )}
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-foreground">{where}</span>
          <span className="text-text-muted"> · {call.propertyName}</span>
        </span>
        <span className="flex shrink-0 items-center gap-3 font-mono text-xs text-text-muted">
          <span>{formatDuration(call.duration_seconds)}</span>
          <span>{formatTimeOnly(call.ring_started_at, call.timeZone)}</span>
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-text-muted transition-transform", expanded && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div id={panelId} className="flex flex-col gap-3 pb-3 pt-1">
          <div className="grid grid-cols-2 gap-3 rounded-input bg-background p-3 sm:grid-cols-3">
            <DetailField label="Started" value={formatCallTime(call.ring_started_at, call.timeZone)} />
            <DetailField label="Duration" value={formatDuration(call.duration_seconds)} />
            <DetailField label="Room" value={call.room_number ?? "—"} />
            <DetailField label="Caller" value={call.caller_number ?? "—"} />
            {call.handlerName != null && <DetailField label="Handled by" value={call.handlerName} />}
          </div>
          {hasNotes ? (
            <div className="rounded-input bg-background p-3">
              <span className="font-label text-[10px] uppercase tracking-[0.06em] text-text-muted">Notes</span>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{call.notes}</p>
            </div>
          ) : (
            <p className="text-xs text-text-muted">No notes recorded for this call.</p>
          )}
        </div>
      )}
    </li>
  );
}
