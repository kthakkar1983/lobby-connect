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

/** A connected (answered) video call live longer than this is treated as dead. */
export const REAP_IN_PROGRESS_AFTER_MS = 30 * 60_000; // 30 min

/** A ringing video call older than this is treated as a dead kiosk (ring window is 120s). */
export const REAP_RINGING_AFTER_MS = 10 * 60_000; // 10 min

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
 * was never answered (no `answered_at`) — mirrors the real-time finalizers.
 */
export function reapDurationSeconds(
  answeredAt: string | null,
  endedAtMs: number,
): number | null {
  if (!answeredAt) return null;
  return Math.max(0, Math.round((endedAtMs - new Date(answeredAt).getTime()) / 1000));
}
