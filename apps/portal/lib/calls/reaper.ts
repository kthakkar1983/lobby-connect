/**
 * Stale-call reaper thresholds + cutoffs.
 *
 * VIDEO calls are finalized by the *kiosk* (`/api/kiosk/call-ended`). If the
 * kiosk browser dies mid-call (crash, freeze, power loss) it never finalizes,
 * so the row leaks forever as RINGING/IN_PROGRESS — invisible to monitoring and
 * masquerading as an active call. AUDIO calls cannot leak this way: Twilio
 * status webhooks finalize them server-side. So the reaper only ever closes
 * VIDEO rows, as a backstop behind the real-time agent-side finalizer.
 */

import { REAP_IN_PROGRESS_AFTER_MS, REAP_RINGING_AFTER_MS } from "@lc/shared";
import { computeDurationSeconds } from "./duration";

export { REAP_IN_PROGRESS_AFTER_MS, REAP_RINGING_AFTER_MS };

export interface ReapCutoffs {
  /** Reap IN_PROGRESS video rows whose `created_at` is before this ISO time. */
  readonly inProgressBefore: string;
  /** Reap RINGING video rows whose `ring_started_at` is before this ISO time. */
  readonly ringingBefore: string;
}

export function reapCutoffs(now: number): ReapCutoffs {
  return {
    inProgressBefore: new Date(now - REAP_IN_PROGRESS_AFTER_MS).toISOString(),
    ringingBefore: new Date(now - REAP_RINGING_AFTER_MS).toISOString(),
  };
}

/**
 * Whether an IN_PROGRESS video row is stale enough to reap. Keyed on
 * `answered_at` when present, so a legitimately long but recently-answered call
 * is not force-closed; falls back to `created_at` when `answered_at` is NULL,
 * preserving the no-blind-spot guarantee (a partial write that left
 * `answered_at` NULL is still reaped via `created_at`).
 */
export function inProgressIsStale(
  row: { created_at: string; answered_at: string | null },
  now: number,
): boolean {
  const start = row.answered_at ?? row.created_at;
  return now - new Date(start).getTime() >= REAP_IN_PROGRESS_AFTER_MS;
}

/**
 * Whole-second duration of a reaped call, clamped to >= 0, or null when the call
 * was never answered (no `answered_at`). Delegates to computeDurationSeconds so
 * the formula is identical across the kiosk route, the agent route, and the reaper.
 */
export function reapDurationSeconds(
  answeredAt: string | null,
  endedAtMs: number,
): number | null {
  return computeDurationSeconds(answeredAt, endedAtMs);
}
