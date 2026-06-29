// Single home for cross-app timing invariants. Imported by both portal and
// kiosk via @lc/shared so the ring window, reaper cutoffs, presence staleness,
// and cron cadence each have exactly one definition.

/** Guest-dial ring window (locked decision 1). Mirrored in the Twilio webhook + kiosk. */
export const RING_WINDOW_SECONDS = 120;
export const RING_WINDOW_MS = RING_WINDOW_SECONDS * 1000;

/** A browser heartbeat older than this is stale: swept OFFLINE by cron, OFFLINE at read. */
export const PRESENCE_STALE_AFTER_MS = 90_000;

/**
 * Safety-net cadence for the agent's incoming-video banner. Realtime push is the
 * primary signal (~1s ring); this slow poll only backstops a silently-dead
 * subscription. 60s is 20x cheaper than the retired 3s poll while push covers
 * real latency. Tunable: raise, or drop to 0 (pure push), once Realtime is proven.
 */
export const INCOMING_VIDEO_FALLBACK_POLL_MS = 60_000;

/** A connected (answered) video call alive longer than this is treated as dead (reaper). */
export const REAP_IN_PROGRESS_AFTER_MS = 30 * 60_000;

/**
 * Hard client-side cap on a CONNECTED video call's wall-clock duration, enforced
 * on BOTH the kiosk and the agent. A real front-desk video call lasts a few
 * minutes; this exists so an ABANDONED call (guest walks away from the kiosk,
 * agent leaves a tab open) cannot keep an Agora channel — and its per-participant
 * billing — alive. It MUST stay under the Agora token TTL (3600s, no renewal in
 * this app) so OUR cap, not a silent token-expiry disconnect, is what ends the
 * call. Aligned with REAP_IN_PROGRESS_AFTER_MS: the client ends the call at the
 * same point the daily reaper would have considered it dead — just immediately,
 * not up to a day later.
 */
export const MAX_CALL_DURATION_MS = REAP_IN_PROGRESS_AFTER_MS;
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

// The call cap must end an abandoned call BEFORE the 3600s Agora token would
// silently expire it, or the cap is pointless. (Token TTL lives in the agora/token
// route; pinned numerically here since this module has no app imports.)
if (MAX_CALL_DURATION_MS >= 3_600_000) {
  throw new Error("protocol: MAX_CALL_DURATION_MS must stay under the 3600s Agora token TTL");
}
