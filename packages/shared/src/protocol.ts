// Single home for cross-app timing invariants. Imported by both portal and
// kiosk via @lc/shared so the ring window, reaper cutoffs, presence staleness,
// and cron cadence each have exactly one definition.

/** Guest-dial ring window (locked decision 1). Mirrored in the Twilio webhook + kiosk. */
export const RING_WINDOW_SECONDS = 120;
export const RING_WINDOW_MS = RING_WINDOW_SECONDS * 1000;

/** Web Push TTL: a push older than the ring window is a stale ring — drop it. */
export const PUSH_TTL_SECONDS = RING_WINDOW_SECONDS;

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
 * agent leaves a tab open) cannot keep a video room — and its cost — alive
 * indefinitely. It MUST stay under the join token minted by /api/video/token
 * (3600s, no renewal in this app) so OUR cap, not a silent token-expiry
 * disconnect, is what ends the call. Aligned with REAP_IN_PROGRESS_AFTER_MS: the
 * client ends the call at the same point the daily reaper would have considered
 * it dead — just immediately, not up to a day later.
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

/**
 * Max-shift cap. Enforced by Supabase's "Time-box user sessions" = 12h dashboard
 * Auth setting (NOT app code): 12h after login the session dies, the heartbeat
 * 401s, presence lapses, and the shift auto-closes at the last beat. This value
 * only labels such a close as `capped` (classifyShiftEnd) and is the number the
 * ops runbook must match. Start at 12h; tighten later.
 */
export const SESSION_MAX_MS = 12 * 60 * 60 * 1000;

/** A close whose duration lands within this sliver of SESSION_MAX_MS is `capped`, not `lapsed`. */
export const SHIFT_CAP_EPSILON_MS = 15 * 60 * 1000;

/**
 * How stale (since last heartbeat) an agent must be before the presence sweep
 * cron flips her `OFFLINE` and closes her open shift — i.e. how long is
 * "genuinely abandoned". Deliberately DISTINCT from `PRESENCE_STALE_AFTER_MS`
 * (90s): that is the READ-TIME reachability signal (effectivePresence / audio
 * dial / dashboards), where a briefly-throttled tab should read offline. Duty +
 * video push, by contrast, are RAW-STATUS — an agent works heads-down in
 * RustDesk with the portal tab throttled/frozen, so a stale heartbeat is her
 * NORMAL working state (see lib/shifts/lifecycle.ts canDoWork + lib/push/targets).
 * Sweeping her `OFFLINE` at 90s would end a live shift AND silence her video push.
 *
 * Set to SESSION_MAX_MS — the MINIMUM horizon that provably fires only after the
 * auth session is dead: a heartbeat can't precede login, and the session dies at
 * login + SESSION_MAX, so last_beat + SESSION_MAX >= session death. Past that she
 * can't be a still-working stale agent (she can't answer or Connect until she
 * re-logs-in). Cleanup PROMPTNESS is a cron-cadence lever, never a reason to
 * shorten this (that re-opens the "ended a working agent's shift" bug).
 */
export const SHIFT_ABANDON_AFTER_MS = SESSION_MAX_MS;

/**
 * App-level max-shift cap — the FREE-TIER stand-in for Supabase's 12h "Time-box
 * user sessions" Auth setting (Pro-only, deferred). SHIFT_ABANDON_AFTER_MS closes
 * a shift only once the heartbeat goes *stale*, so a forgotten shift on an AWAKE
 * machine that keeps beating (dashboard left open + on duty on a box that never
 * sleeps) never goes stale → the abandon sweep never sees it → clocked hours
 * inflate unbounded (computeClockedSeconds only bounds an open-but-STALE shift).
 *
 * So the presence sweep ALSO force-closes any open shift whose `started_at` is
 * older than this — regardless of staleness — at the CEILING (`started_at +
 * MAX_SHIFT_MS`, never "now"/`last_seen_at`, both of which grow with cron cadence
 * and re-introduce the inflation), reason `capped`, and flips the agent OFFLINE
 * (except mid-call). SHIFT-anchored, not login-anchored: needs no login timestamp
 * and sidesteps classifyShiftEnd's session-vs-shift labeling quirk.
 *
 * The PRIMARY max-shift ceiling: at 10h it fires BEFORE the deferred 12h Supabase
 * session cap, so if that Pro setting is later enabled it becomes a redundant
 * outer backstop, not the primary. 10h is a deliberately tight ceiling just past a
 * full night shift: a genuine agent who runs past it is bounced off duty and
 * re-Goes-on-duty for a fresh shift (two rows) — the correct bias for accurate
 * clocked time. Design: docs/specs/2026-07-13-app-level-max-shift-cap-design.md.
 */
export const MAX_SHIFT_MS = 10 * 60 * 60 * 1000;

/** Outbound (agent -> kiosk) ring window. Shorter than the 120s inbound window —
 *  the agent shouldn't stare at "Calling…". At timeout the row finalizes NO_ANSWER. */
export const OUTBOUND_RING_WINDOW_SECONDS = 30;
export const OUTBOUND_RING_WINDOW_MS = OUTBOUND_RING_WINDOW_SECONDS * 1000;

/** A kiosk whose last heartbeat/poll is older than this reads OFFLINE.
 *  ~90s survives one missed 30s heartbeat. Distinct signal from PRESENCE_STALE_AFTER_MS
 *  (kiosk device liveness vs agent-browser presence). */
export const KIOSK_STALE_AFTER_MS = 90_000;

/** Post-call reconnect window. The kiosk disables tap-to-call for this long after a
 *  terminal drop (calm "reconnecting" message) and the agent's "Call back" shortcut is
 *  visible for the same span — paired so the agent has right-of-way to reconnect. */
export const RECONNECT_WINDOW_MS = 10_000;

// The reaper must outlast the ring window, or a still-ringing call could be reaped
// mid-window. TypeScript can't compare number *values* at the type level, so guard
// at module load; protocol.test.ts pins the same invariant.
if (REAP_RINGING_AFTER_MS <= RING_WINDOW_MS) {
  throw new Error("protocol: REAP_RINGING_AFTER_MS must exceed RING_WINDOW_MS");
}

// The call cap must end an abandoned call BEFORE the 3600s video join token would
// silently expire it, or the cap is pointless. (Token TTL lives in the video/token
// route; pinned numerically here since this module has no app imports.)
if (MAX_CALL_DURATION_MS >= 3_600_000) {
  throw new Error("protocol: MAX_CALL_DURATION_MS must stay under the 3600s video join token TTL");
}

// The abandon horizon (when the cron ends a shift) must never be shorter than the
// read-time reachability staleness (a throttled-but-working tab), or the cron would
// end a live shift — the exact bug this constant exists to prevent.
if (SHIFT_ABANDON_AFTER_MS < PRESENCE_STALE_AFTER_MS) {
  throw new Error("protocol: SHIFT_ABANDON_AFTER_MS must not be shorter than PRESENCE_STALE_AFTER_MS");
}

// A shift-length ceiling must outlast the read-time reachability staleness, or the
// cap could fire on a shift younger than a single stale-heartbeat window.
// protocol.test.ts pins the same invariant.
if (MAX_SHIFT_MS <= PRESENCE_STALE_AFTER_MS) {
  throw new Error("protocol: MAX_SHIFT_MS must exceed PRESENCE_STALE_AFTER_MS");
}

// The outbound ring window must stay under the reaper's ringing backstop, or a
// still-ringing outbound call could be reaped mid-window. protocol.test.ts pins
// the same invariant.
if (OUTBOUND_RING_WINDOW_MS >= REAP_RINGING_AFTER_MS) {
  throw new Error(
    "OUTBOUND_RING_WINDOW_MS must be under REAP_RINGING_AFTER_MS (the reaper is the backstop)",
  );
}
