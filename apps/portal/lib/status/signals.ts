// Pure classification for the /status page. Thresholds live here (not in the
// DB row) so they tune without a migration. Two signal kinds share the table:
//   - 'liveness': a job that should run on a cadence; stale => warn/down.
//   - 'info': a fact whose absence isn't an outage (a quiet pilot has no calls);
//             green once ever seen, grey if never.

export type SignalStatus = "ok" | "warn" | "down" | "unknown";
export type SignalMode = "liveness" | "info";

export type SignalSpec = {
  signal: string;
  label: string;
  mode: SignalMode;
  warnAfterMs?: number;
  downAfterMs?: number;
};

// Presence-sweep cron cadence. PILOT (Vercel Hobby caps crons at once/day) = daily.
// BEFORE LAUNCH: set apps/portal/vercel.json's cron schedule back to "* * * * *"
// AND change this constant to 60_000 (per-minute), then move to Vercel Pro. The
// thresholds below derive from it, so this one constant is the entire switch.
const CRON_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily (pilot). Per-minute = 60_000.

export const SIGNAL_SPECS: readonly SignalSpec[] = [
  { signal: "twilio_webhook", label: "Twilio webhook", mode: "info" },
  {
    signal: "cron_mark_stale_offline",
    label: "Presence sweep (cron)",
    mode: "liveness",
    warnAfterMs: CRON_SWEEP_INTERVAL_MS * 1.5, // 1.5 missed intervals → warn
    downAfterMs: CRON_SWEEP_INTERVAL_MS * 3, // 3 missed intervals → treat as stopped
  },
] as const;

export function classifyHeartbeat(
  lastOkAt: string | null,
  now: number,
  spec: SignalSpec,
): SignalStatus {
  if (!lastOkAt) return "unknown";
  if (spec.mode === "info") return "ok";
  const ageMs = now - new Date(lastOkAt).getTime();
  if (spec.downAfterMs !== undefined && ageMs >= spec.downAfterMs) return "down";
  if (spec.warnAfterMs !== undefined && ageMs >= spec.warnAfterMs) return "warn";
  return "ok";
}

export function classifyProbe(ok: boolean): SignalStatus {
  return ok ? "ok" : "down";
}

export function classifyErrorCount(count: number | null): SignalStatus {
  if (count === null) return "unknown";
  if (count === 0) return "ok";
  if (count < 10) return "warn";
  return "down";
}
