import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Route } from "next";
import type { ProfileStatus, CallState, CallChannel } from "@lc/shared";
import { Card } from "@/components/ui/card";
import { DashTile } from "@/components/dashboard/dash-tile";
import { HourlyVolumeChart, HourlyLegend } from "@/components/dashboard/channel-viz";
import { CallRow, type CallRowData } from "@/components/call/call-row";
import { hourlyVolume, countByOutcome, avgPickupSeconds, type DatedCall } from "@/lib/dashboard/calls";
import { presenceDotClass, presenceLabel, isLivePresence, formatTimeOnly, formatDuration } from "@/lib/owner/format";
import { cn } from "@/lib/utils";

const LABEL = "font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted";

export type OverviewCall = DatedCall & {
  readonly state: CallState;
  readonly channel: CallChannel;
  readonly answered_at: string | null;
};

export function PropertyOverview({
  propertyId,
  propertyName,
  agent,
  todayCalls,
  recent,
  openIncidents,
  now,
}: {
  readonly propertyId: string;
  readonly propertyName: string;
  readonly agent: { readonly full_name: string; readonly status: ProfileStatus } | null;
  readonly todayCalls: ReadonlyArray<OverviewCall>;
  readonly recent: ReadonlyArray<CallRowData>;
  readonly openIncidents: number;
  readonly now: Date;
}) {
  const outcomes = countByOutcome(todayCalls, now);
  const pickup = avgPickupSeconds(todayCalls, now);
  const hourly = hourlyVolume(todayCalls, now);
  const lastCall = todayCalls[0] ? formatTimeOnly(todayCalls[0].ring_started_at, todayCalls[0].timeZone) : "—";
  const live = agent ? isLivePresence(agent.status) : false;
  const callsHref = (outcome: "answered" | "missed") => `/owner/calls?outcome=${outcome}` as Route;

  return (
    <div className="flex flex-col gap-4">
      {/* Coverage strip */}
      <Card className={cn("flex-row items-center justify-between gap-3 p-4", openIncidents > 0 ? "border-l-2 border-l-attention" : live && "border-l-2 border-l-live")}>
        <span className="font-display text-lg font-medium text-foreground">{propertyName}</span>
        {agent ? (
          <span className="inline-flex items-center gap-2 text-sm text-text-muted">
            <span className={cn("size-2 rounded-full", presenceDotClass(agent.status))} aria-hidden="true" />
            {agent.full_name} · {presenceLabel(agent.status)}
          </span>
        ) : (
          <span className="text-sm text-text-muted">No agent assigned</span>
        )}
      </Card>

      {/* Drill-through stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <DashTile value={outcomes.answered} label="Answered" tone="live" href={callsHref("answered")} />
        <DashTile value={outcomes.missed} label="Missed" tone={outcomes.missed > 0 ? "attention" : "default"} href={callsHref("missed")} />
        <DashTile value={formatDuration(pickup)} label="Avg pickup" />
        <DashTile value={lastCall} label="Last call" />
      </div>

      {/* Tonight · call volume (graceful quiet-night state) */}
      <Card className="gap-3 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={LABEL}>Tonight · call volume</h2>
          {todayCalls.length > 0 && <HourlyLegend />}
        </div>
        {todayCalls.length > 0 ? (
          <HourlyVolumeChart data={hourly} className="mt-1" />
        ) : (
          <p className="py-6 text-center text-sm text-text-muted">Quiet so far tonight.</p>
        )}
      </Card>

      {/* Recent + Incidents + Manage */}
      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,18rem)]">
        <Card className="gap-2 p-5">
          <div className="flex items-center justify-between">
            <h2 className={LABEL}>Recent calls</h2>
            <Link href="/owner/calls" className="text-sm text-accent-text hover:underline">View all</Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-text-muted">No calls yet.</p>
          ) : (
            <div className="flex flex-col gap-2">{recent.map((c) => <CallRow key={c.detail.id} call={c} />)}</div>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="gap-2 p-5">
            <h2 className={LABEL}>Incidents</h2>
            {openIncidents > 0 ? (
              <Link href="/owner/incidents" className="inline-flex items-center gap-2 text-sm font-medium text-attention-text hover:underline">
                {openIncidents} open incident{openIncidents === 1 ? "" : "s"} <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            ) : (
              <p className="inline-flex items-center gap-2 text-sm text-live-foreground">All clear tonight</p>
            )}
          </Card>
          <Card className="gap-1 p-5">
            <h2 className={LABEL}>Manage</h2>
            <Link href={`/owner/properties/${propertyId}` as Route} className="flex items-center justify-between py-2 text-sm text-accent-text hover:underline">
              Property, kiosk &amp; playbook <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
