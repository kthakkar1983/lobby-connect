// Single home for cross-app timing invariants. Imported by both portal and
// kiosk via @lc/shared so the ring window, reaper cutoffs, presence staleness,
// and cron cadence each have exactly one definition.

/** Guest-dial ring window (locked decision 1). Mirrored in the Twilio webhook + kiosk. */
export const RING_WINDOW_SECONDS = 120;
export const RING_WINDOW_MS = RING_WINDOW_SECONDS * 1000;

/** A browser heartbeat older than this is stale: swept OFFLINE by cron, OFFLINE at read. */
export const PRESENCE_STALE_AFTER_MS = 90_000;

/** A connected (answered) video call alive longer than this is treated as dead (reaper). */
export const REAP_IN_PROGRESS_AFTER_MS = 30 * 60_000;
/** A ringing video call older than this is treated as a dead kiosk (reaper). */
export const REAP_RINGING_AFTER_MS = 10 * 60_000;

/**
 * Presence-sweep cron cadence. PILOT (Vercel Hobby caps crons at once/day) = daily.
 * BEFORE PUBLIC LAUNCH: move to Vercel Pro, set apps/portal/vercel.json's cron
 * schedule back to "* * * * *", and change this to 60_000. The /status thresholds
 * derive from it, so this constant is the entire switch.
 */
export const CRON_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// The reaper must outlast the ring window, or a still-ringing call could be reaped
// mid-window. TypeScript can't compare number *values* at the type level, so guard
// at module load; protocol.test.ts pins the same invariant.
if (REAP_RINGING_AFTER_MS <= RING_WINDOW_MS) {
  throw new Error("protocol: REAP_RINGING_AFTER_MS must exceed RING_WINDOW_MS");
}
