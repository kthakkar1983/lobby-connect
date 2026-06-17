import { ChevronLeft, Building2 } from "lucide-react";
import Link from "next/link";

import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import {
  phoneHealthRollup,
  failureSummaryToday,
  type FailureSummary,
} from "@/lib/dashboard/phone-health";
import { formatTimeOnly } from "@/lib/owner/format";
import { cn } from "@/lib/utils";

const LABEL = "font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted";

function reasonText(f: FailureSummary, timeZone: string): string {
  const noun = f.count === 1 ? "failed call" : "failed calls";
  return `${f.count} ${noun} today · last at ${formatTimeOnly(f.lastFailureAt, timeZone)}`;
}

/**
 * Admin phone-health detail (drill-in from the command-center "Phone health"
 * tile). Read-only, operator-wide. A property "needs attention" on the same
 * predicate as the tile — >= 1 FAILED call today in the property's timezone —
 * via the shared `phoneHealthRollup`; the blaze reason line comes from
 * `failureSummaryToday`. Both derive from FAILED-today, so they never disagree.
 *
 * v2 seam: the *real* Twilio failure reason needs a `calls.failure_reason`
 * column written from the status webhook (no error/code is stored today).
 */
export default async function PhoneHealthPage() {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();
  const now = new Date();
  // 48h lookback safely covers "today" in any property timezone (max offset + a
  // full local day). The rollup/summary then filter to today per-property tz.
  const since = new Date(now.getTime() - 48 * 3600_000).toISOString();

  const [{ data: properties }, { data: rawCalls }] = await Promise.all([
    supabase
      .from("properties")
      .select("id, name, routing_did, property_phone_number, after_hours_support_phone, timezone")
      .eq("operator_id", actor.operator_id)
      .eq("active", true)
      .order("name"),
    // Only FAILED rows matter here — both helpers ignore every other state.
    supabase
      .from("calls")
      .select("property_id, state, ring_started_at")
      .eq("operator_id", actor.operator_id)
      .eq("state", "FAILED")
      .gte("ring_started_at", since),
  ]);

  const props = properties ?? [];
  const tzById = new Map(props.map((p) => [p.id, p.timezone]));
  const calls = (rawCalls ?? []).map((c) => ({
    property_id: c.property_id,
    state: c.state,
    ring_started_at: c.ring_started_at,
    timeZone: tzById.get(c.property_id) ?? "UTC",
  }));

  const health = phoneHealthRollup(
    props.map((p) => ({ id: p.id, name: p.name, timeZone: p.timezone })),
    calls,
    now,
  );
  const attentionIds = new Set(health.needAttention.map((p) => p.id));
  const failures = failureSummaryToday(calls, now);

  // Problem properties float to the top (mirrors the command-center board).
  const rows = props
    .map((p) => ({ ...p, attention: attentionIds.has(p.id), failure: failures.get(p.id) ?? null }))
    .sort((a, b) => Number(b.attention) - Number(a.attention) || a.name.localeCompare(b.name));

  const attentionCount = health.needAttention.length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          href="/admin"
          className="inline-flex w-fit items-center gap-1 text-sm text-text-muted transition-colors hover:text-accent-text"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Command center
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Phone health</h1>
          <p className="mt-1 text-sm text-text-muted">
            Per-property line status across your operator. A property needs attention when a call
            failed today, in its local time.
          </p>
        </div>
      </header>

      {props.length === 0 ? (
        <Card className="p-5 shadow-md">
          <EmptyState
            icon={Building2}
            title="No active properties"
            description="Add a property to start monitoring its phone line."
          />
        </Card>
      ) : (
        <Card className="gap-3 p-5 shadow-md">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={LABEL}>Lines</h2>
            <span className="flex items-baseline gap-2">
              <span
                className={cn(
                  "font-mono text-sm font-semibold",
                  attentionCount > 0 ? "text-attention-text" : "text-live-foreground",
                )}
              >
                {health.ok}/{health.total}
              </span>
              <span className="text-xs text-text-muted">
                {attentionCount > 0 ? `${attentionCount} need attention` : "lines OK"}
              </span>
            </span>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Routing number</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id} className={p.attention ? "bg-attention/5" : undefined}>
                  <TableCell className="font-medium text-foreground">{p.name}</TableCell>
                  <TableCell className="align-top">
                    {p.routing_did ? (
                      <span className="font-mono text-sm text-foreground">{p.routing_did}</span>
                    ) : (
                      <span className="text-text-muted">Not set</span>
                    )}
                    {p.property_phone_number || p.after_hours_support_phone ? (
                      <div className="mt-0.5 flex flex-col gap-0.5 text-[11px] text-text-muted">
                        {p.property_phone_number ? (
                          <span>Front desk · {p.property_phone_number}</span>
                        ) : null}
                        {p.after_hours_support_phone ? (
                          <span>After-hours · {p.after_hours_support_phone}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="align-top">
                    {p.attention ? (
                      <Badge variant="attention">Needs attention</Badge>
                    ) : (
                      <Badge variant="live">Lines OK</Badge>
                    )}
                  </TableCell>
                  <TableCell className="align-top text-sm text-text-muted">
                    {p.attention && p.failure ? reasonText(p.failure, p.timezone) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
