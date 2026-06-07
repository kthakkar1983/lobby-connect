import Link from "next/link";
import { Phone, Video } from "lucide-react";
import type { CallState } from "@lc/shared";
import { StatusPill } from "@/components/owner/status-pill";
import { formatTimeOnly, formatDuration } from "@/lib/owner/format";

export type CallRowData = {
  readonly id: string;
  readonly channel: string;
  readonly state: CallState;
  readonly ring_started_at: string;
  readonly duration_seconds: number | null;
  readonly timeZone: string;
  readonly secondary: string; // pre-composed (handler · property · room …)
};

export function CallRow({ call }: { readonly call: CallRowData }) {
  const Icon = call.channel === "VIDEO" ? Video : Phone;
  return (
    <Link
      href={`/owner/calls/${call.id}` as never}
      className="flex items-center gap-3 rounded-card border border-border bg-card p-3 shadow-sm transition-colors hover:border-accent/40"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-input bg-muted text-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">
            {formatTimeOnly(call.ring_started_at, call.timeZone)}
          </span>
          <StatusPill kind="call" status={call.state} />
        </span>
        <span className="mt-0.5 block truncate text-xs text-text-muted">
          {call.secondary}
          {` · ${formatDuration(call.duration_seconds)}`}
        </span>
      </span>
    </Link>
  );
}
