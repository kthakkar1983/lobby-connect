"use client";

import { useId, useState } from "react";
import { Phone, Video, StickyNote, ChevronDown } from "lucide-react";
import { StatusPill } from "@/components/owner/status-pill";
import { formatTimeOnly, formatDuration } from "@/lib/owner/format";
import { CallDetailBody, type CallDetail } from "@/components/owner/call-detail-body";
import { cn } from "@/lib/utils";

export type CallRowData = {
  readonly secondary: string; // pre-composed (handler · property · room …)
  readonly detail: CallDetail;
};

export function CallRow({ call }: { readonly call: CallRowData }) {
  const { detail, secondary } = call;
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const Icon = detail.channel === "VIDEO" ? Video : Phone;
  const hasNotes = Boolean(detail.notes?.trim());

  return (
    <div className="rounded-card border border-border bg-card shadow-sm transition-colors hover:border-accent/40">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-input bg-muted text-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        {hasNotes && (
          <StickyNote className="size-3.5 shrink-0 text-text-muted" role="img" aria-label="Has notes" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">
              {formatTimeOnly(detail.ring_started_at, detail.timeZone)}
            </span>
            <StatusPill kind="call" status={detail.state} />
          </span>
          <span className="mt-0.5 block truncate text-xs text-text-muted">
            {secondary}
            {` · ${formatDuration(detail.duration_seconds)}`}
          </span>
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-text-muted transition-transform", expanded && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div id={panelId} className="border-t border-border p-4">
          <CallDetailBody data={detail} />
        </div>
      )}
    </div>
  );
}
