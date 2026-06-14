import Link from "next/link";
import { Siren } from "lucide-react";
import type { Route } from "next";
import type { IncidentStatus } from "@lc/shared";
import { StatusPill } from "@/components/owner/status-pill";
import { formatCallTime } from "@/lib/owner/format";
import { cn } from "@/lib/utils";

export type IncidentRowData = {
  readonly id: string;
  readonly status: IncidentStatus;
  readonly dispatched_to: string;
  readonly created_at: string;
  readonly propertyName: string;
  readonly timeZone: string;
};

export function IncidentRow({ incident }: { readonly incident: IncidentRowData }) {
  const open = incident.status !== "RESOLVED";
  return (
    <Link
      href={`/owner/incidents/${incident.id}` as Route}
      className={cn(
        "flex items-center gap-3 rounded-card border border-border bg-card p-3 shadow-sm transition-colors hover:border-accent/40",
        open && "border-l-2 border-l-destructive",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-input",
          open ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
        )}
      >
        <Siren className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">911 Emergency</span>
          <StatusPill kind="incident" status={incident.status} />
        </span>
        <span className="mt-0.5 block truncate text-xs text-text-muted">
          {incident.propertyName} · {formatCallTime(incident.created_at, incident.timeZone)} · dispatched to{" "}
          {incident.dispatched_to}
        </span>
      </span>
    </Link>
  );
}
