import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { getRecentErrorCount } from "@/lib/sentry/errors";
import {
  SIGNAL_SPECS,
  classifyHeartbeat,
  classifyProbe,
  classifyErrorCount,
} from "@/lib/status/signals";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusCard } from "./status-card";

function relative(iso: string | null): string {
  if (!iso) return "never";
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}

export default async function AdminStatusPage() {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();

  // Pull signal 1: Supabase round-trip.
  let supabaseOk = true;
  try {
    const { error } = await supabase
      .from("health_signals")
      .select("signal")
      .limit(1);
    supabaseOk = !error;
  } catch {
    supabaseOk = false;
  }

  // Pull signal 2: Sentry issue count (null => degrade to link-only).
  const errorCount = await getRecentErrorCount();
  const sentryUrl =
    process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
      ? `https://sentry.io/organizations/${process.env.SENTRY_ORG}/projects/${process.env.SENTRY_PROJECT}/`
      : "https://sentry.io/";

  // Push signals: heartbeat registry for this operator.
  const { data: signals } = await supabase
    .from("health_signals")
    .select("signal, last_ok_at")
    .eq("operator_id", actor.operator_id);
  const lastBySignal = new Map(
    (signals ?? []).map((s) => [s.signal, s.last_ok_at]),
  );
  const now = Date.now();

  return (
    <div className="flex w-full max-w-4xl flex-col gap-4 p-6">
      <AutoRefresh />
      <h1 className="text-2xl font-semibold text-foreground">Status</h1>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatusCard
          label="Supabase"
          status={classifyProbe(supabaseOk)}
          value={supabaseOk ? "Reachable" : "Unreachable"}
        />
        <StatusCard
          label="Recent errors (24h)"
          status={classifyErrorCount(errorCount)}
          value={
            errorCount === null
              ? "Sentry unavailable"
              : `${errorCount} unresolved`
          }
          href={sentryUrl}
        />
        {SIGNAL_SPECS.map((spec) => {
          const last = lastBySignal.get(spec.signal) ?? null;
          return (
            <StatusCard
              key={spec.signal}
              label={spec.label}
              status={classifyHeartbeat(last, now, spec)}
              value={`Last: ${relative(last)}`}
            />
          );
        })}
      </div>
    </div>
  );
}
