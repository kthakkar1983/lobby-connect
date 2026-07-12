"use client";

// Task 19 (shift-tracking plan): the admin timesheet table. Read-only display
// — row actions (edit end time / delete / add a missed shift) are Task 20.
// Modeled on `admin/audit/audit-table.tsx`: a `"use client"` table that owns
// URL-driven filter state via `router.push`, fed by a Server Component page.

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { Clock } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { DashTile } from "@/components/dashboard/dash-tile";
import { computeUtilization } from "@/lib/shifts/lifecycle";
import type { ShiftTimesheetRow, TimesheetRange } from "@/lib/shifts/query";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Small pure display helpers (presentational only — no lib/ home needed for
// these; the metric math they format lives in lib/shifts/lifecycle.ts).
// ---------------------------------------------------------------------------

/** "8h 12m" / "45m" / "—" for a zero duration. */
function formatClocked(seconds: number): string {
  if (seconds <= 0) return "—";
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const SHIFT_TIME_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatShiftTime(iso: string): string {
  return SHIFT_TIME_FMT.format(new Date(iso));
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s.charAt(0) + s.slice(1).toLowerCase();
}

const ENDED_BADGE: Record<
  "manual" | "lapsed" | "capped" | "open",
  { label: string; variant: "secondary" | "attention" | "live" }
> = {
  manual: { label: "Ended shift", variant: "secondary" },
  lapsed: { label: "Tab closed", variant: "attention" },
  capped: { label: "Capped 12h", variant: "attention" },
  open: { label: "On shift", variant: "live" },
};

function EndedBadge({ endedReason }: { readonly endedReason: ShiftTimesheetRow["endedReason"] }) {
  const key = endedReason ?? "open";
  const { label, variant } = ENDED_BADGE[key];
  return <Badge variant={variant}>{label}</Badge>;
}

function UtilizationBar({ value }: { readonly value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-accent" style={{ width: `${clamped}%` }} />
      </div>
      <span className="w-9 text-right font-mono text-xs tabular-nums text-text-muted">
        {clamped}%
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Period selector — pushes ?from/?to (URL-driven, like audit-table's filter).
// "This week" sends only `from` (query layer defaults `to` to now); "Last
// week" sends both as fixed UTC-week boundaries; "Custom" reveals two date
// inputs. Fleet-wide report, no single property/timezone to anchor to, so
// week boundaries are UTC (mirrors query.ts's own range-default reasoning).
// ---------------------------------------------------------------------------

type PeriodValue = "default" | "this-week" | "last-week" | "custom";

function startOfUtcWeek(d: Date): string {
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - diff);
  return start.toISOString();
}

function PeriodSelector({ range }: { readonly range: TimesheetRange }) {
  const router = useRouter();
  const params = useSearchParams();

  const thisWeekFromIso = useMemo(() => startOfUtcWeek(new Date()), []);
  const lastWeekFromIso = useMemo(
    () => new Date(Date.parse(thisWeekFromIso) - 7 * 24 * 60 * 60 * 1000).toISOString(),
    [thisWeekFromIso],
  );

  const spFrom = params.get("from");
  const spTo = params.get("to");

  const detected: PeriodValue = !spFrom && !spTo
    ? "default"
    : spFrom === thisWeekFromIso && !spTo
      ? "this-week"
      : spFrom === lastWeekFromIso && spTo === thisWeekFromIso
        ? "last-week"
        : "custom";

  const [showCustom, setShowCustom] = useState(detected === "custom");
  const [customFrom, setCustomFrom] = useState(() => range.fromIso.slice(0, 10));
  const [customTo, setCustomTo] = useState(() => range.toIso.slice(0, 10));

  function navigate(next: URLSearchParams) {
    router.push(`/admin/shifts?${next.toString()}` as Route);
  }

  function setPeriod(value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value === "default") {
      setShowCustom(false);
      sp.delete("from");
      sp.delete("to");
      navigate(sp);
      return;
    }
    if (value === "this-week") {
      setShowCustom(false);
      sp.set("from", thisWeekFromIso);
      sp.delete("to");
      navigate(sp);
      return;
    }
    if (value === "last-week") {
      setShowCustom(false);
      sp.set("from", lastWeekFromIso);
      sp.set("to", thisWeekFromIso);
      navigate(sp);
      return;
    }
    // "custom": reveal the date inputs; don't navigate until Apply.
    setShowCustom(true);
  }

  function applyCustomRange() {
    if (!customFrom || !customTo) return;
    const sp = new URLSearchParams(params.toString());
    sp.set("from", new Date(`${customFrom}T00:00:00.000Z`).toISOString());
    sp.set("to", new Date(`${customTo}T23:59:59.999Z`).toISOString());
    navigate(sp);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={detected === "custom" ? "custom" : detected} onValueChange={setPeriod}>
        <SelectTrigger className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Last 7 days</SelectItem>
          <SelectItem value="this-week">This week</SelectItem>
          <SelectItem value="last-week">Last week</SelectItem>
          <SelectItem value="custom">Custom range</SelectItem>
        </SelectContent>
      </Select>
      <span className="text-sm text-text-muted">{range.label}</span>
      {showCustom && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="w-40"
            aria-label="Range start"
          />
          <span className="text-text-muted">–</span>
          <Input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="w-40"
            aria-label="Range end"
          />
          <Button size="sm" onClick={applyCustomRange}>
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary strip
// ---------------------------------------------------------------------------

function SummaryStrip({ rows }: { readonly rows: ShiftTimesheetRow[] }) {
  const totals = rows.reduce(
    (acc, r) => ({
      clocked: acc.clocked + r.clockedSeconds,
      talk: acc.talk + r.talkSeconds,
      capped: acc.capped + (r.endedReason === "capped" ? 1 : 0),
    }),
    { clocked: 0, talk: 0, capped: 0 },
  );
  const fleetUtilization = computeUtilization(totals.clocked, totals.talk);

  return (
    <div className="flex flex-wrap gap-3">
      <DashTile value={formatClocked(totals.clocked)} label="Clocked" />
      <DashTile value={formatClocked(totals.talk)} label="Actual work" />
      <DashTile
        value={`${fleetUtilization}%`}
        label="Fleet utilization"
        tone={fleetUtilization >= 50 ? "live" : "default"}
      />
      <DashTile
        value={totals.capped}
        label="Shifts capped"
        tone={totals.capped > 0 ? "attention" : "default"}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function ShiftsTable({
  rows,
  range,
}: {
  readonly rows: ShiftTimesheetRow[];
  readonly range: TimesheetRange;
}) {
  return (
    <div className="flex flex-col gap-4">
      <PeriodSelector range={range} />
      <SummaryStrip rows={rows} />

      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border">
          <EmptyState
            icon={Clock}
            title="No shifts in this period"
            description="Shifts open when an agent goes on duty and close on end-shift, a lapsed heartbeat, or the 12h cap."
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                Agent
              </TableHead>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                Shift
              </TableHead>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                Clocked
              </TableHead>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                Calls
              </TableHead>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                Talk
              </TableHead>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                Remote
              </TableHead>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                Utilization
              </TableHead>
              <TableHead className="font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                Ended
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.userId}-${row.startedAt}`} className="even:bg-muted/40">
                <TableCell>
                  <div className="flex items-center gap-3">
                    <span
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground"
                      aria-hidden="true"
                    >
                      {initialsOf(row.name) || "?"}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{row.name}</div>
                      <div className="font-label text-[10px] uppercase tracking-[0.08em] text-text-muted">
                        {titleCase(row.role)}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className={cn("whitespace-nowrap tabular-nums text-foreground")}>
                  {formatShiftTime(row.startedAt)} – {row.endedAt ? formatShiftTime(row.endedAt) : "—"}
                </TableCell>
                <TableCell className="tabular-nums text-foreground">
                  {formatClocked(row.clockedSeconds)}
                </TableCell>
                <TableCell className="tabular-nums text-foreground">{row.callCount}</TableCell>
                <TableCell className="tabular-nums text-foreground">
                  {formatClocked(row.talkSeconds)}
                </TableCell>
                <TableCell className="tabular-nums text-foreground">{row.remoteCount}</TableCell>
                <TableCell>
                  <UtilizationBar value={row.utilization} />
                </TableCell>
                <TableCell>
                  <EndedBadge endedReason={row.endedReason} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
