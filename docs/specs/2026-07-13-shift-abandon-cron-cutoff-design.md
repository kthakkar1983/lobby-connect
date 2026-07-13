# Shift-abandon cron cutoff — design

**Date:** 2026-07-13
**Task:** `task_71d65b0a` (completion) — the last path that can end a genuinely-on-duty agent's shift mid-shift.
**Status:** design approved (Kumar, 2026-07-13); value `SHIFT_ABANDON_AFTER_MS = 12h` locked.

## 1. Problem

Since `64b6d90` ("duty is raw-status, not staleness"), a stale portal heartbeat no longer
ends a shift — an agent works heads-down in the RustDesk client with the portal tab
throttled/frozen, so a stale heartbeat is her **normal working state**. The per-beat
lapse-persist was removed and the heartbeat now refreshes any non-`OFFLINE` shift.

One path was left behind (flagged in `64b6d90`'s own message as the follow-up): the presence
cron `GET /api/cron/mark-stale-offline` still sweeps **any** agent whose `last_seen_at` is
stale past `PRESENCE_STALE_AFTER_MS` (90s) → sets `status = OFFLINE` **and** closes her open
shift (`closeOpenShiftForUser`, `ended_reason` derived). Because duty is now raw-status, that
90s flip is the one remaining way to end a genuinely-working agent's shift mid-shift: a truly
frozen tab caught at the daily 04:00/08:00 run leaves her `OFFLINE`, so she is 403'd on
`answer-video` and `Connect` — and silenced on Web Push — until she re-clicks **Go on duty**.

Currently **LOW** impact (daily cadence; requires a >90s full freeze at the instant the cron
runs) but it is the true completion of the raw-status fix.

## 2. Why 90s is the wrong cutoff here

The 90s flip serves **reachability** (don't ring/dial a stale agent). But tracing every
presence consumer shows the persisted `OFFLINE` at 90s does nothing that isn't already handled
at read-time — except one thing that is actively wrong for a throttled-but-working agent:

| Consumer | Reads | Needs the persisted 90s flip? |
|---|---|---|
| Audio dial (`isReachableForDial`) | `effectivePresence` (read-time staleness) | No — already skips a 90s-stale agent live |
| Dashboards / fleet / owner | `effectivePresence` (read-time) | No — computed live |
| Video **push** target (`resolveTargetUserIds`) | **raw status** (`isVideoSilencedStatus`) | Yes — and this is the problem |
| Video **poll** actor gate (`incoming-video`) | **raw status** | Yes — same |
| Duty work-gate (`canDoWork` → answer-video / Connect) | **raw status** | Yes — same |

The video push/poll gates read **raw status on purpose** — a throttled on-shift tab must still
be woken by push (`lib/push/targets.ts` explicitly forbids switching them to `effectivePresence`).
So flipping her `OFFLINE` at 90s re-breaks the exact pushed-video path `64b6d90` fixed, **and**
ends her shift. Everything that legitimately reacts to short-horizon staleness already does so
at read-time, untouched by the persisted flip. The persisted `OFFLINE` therefore has only one
legitimate job: cleaning up a **genuinely abandoned** agent (stop pushing a dead endpoint +
close her timesheet).

## 3. Design

Reachability and shift-closing share **one** question — *how long stale = genuinely gone?* —
and read-time reachability already owns the short (90s) horizon. The cron should own only the
**abandon** horizon.

**Decouple the cron's cutoff from `PRESENCE_STALE_AFTER_MS` into a new
`SHIFT_ABANDON_AFTER_MS` in `packages/shared/src/protocol.ts`.** The cron flips `OFFLINE` +
closes the shift **only** for agents stale beyond that longer horizon. `PRESENCE_STALE_AFTER_MS`
(90s) stays purely the read-time reachability signal. Nothing else changes: the per-operator
cron liveness self-report stays, the query shape stays, the cron **schedule** is not touched.

### 3.1 The value — `SHIFT_ABANDON_AFTER_MS = SESSION_MAX_MS` (12h)

The cron measures `now - last_seen_at` (since last heartbeat — the only "gone" signal we have;
login time is not stored on our side). 12h is not arbitrary — it is the **minimum horizon that
provably fires only after the auth session is dead**:

```
last_beat ≥ login                     (a beat can't precede login)
session dies at login + SESSION_MAX    (Supabase "Time-box user sessions" = 12h)
⇒ last_beat + 12h ≥ login + 12h = session death
```

So a working agent is safe even if her tab freezes for hours: her staleness-while-session-alive
is bounded by 12h, and the sweep never fires until she is provably logged out (can't answer or
Connect until she re-logs-in). Defining `SHIFT_ABANDON_AFTER_MS = SESSION_MAX_MS` (rather than a
bare literal) keeps that derivation explicit and single-sourced.

Rejected alternative — a shorter intermediate value (~1–2h): it re-opens a slower version of the
`64b6d90` bug. A genuinely-working agent through a quiet night-audit stretch (no calls, no
Connect clicks → no beats for 2h+) would be swept `OFFLINE` mid-shift. The product's value call
in `64b6d90` was explicit — *a stale heartbeat is normal working state; never end her shift for
it* — and 12h is the only horizon consistent with it.

Rejected alternative — tracking a login/clock-in timestamp and capping at that + 12h: redundant
(Supabase already enforces the 12h-from-login session cap for free, doubling as security), the
shift's clock-in is already `shifts.started_at`, the auth session doesn't map 1:1 to shifts
(multiple go-on-duty per login), and it would not remove the staleness check (the "closed tab
mid-session" case is still pure staleness). More machinery, no gain.

### 3.2 Accepted trade-off

The only cost of 12h: a **gone** agent who forgot **End shift** (closed the tab) stays a
video-**push** target for up to ~12h after her last beat, and her open shift lingers. All three
downsides are low-severity and self-healing:

- **Guest experience is unchanged** — a gone sole-agent's calls apologise after the ring window
  regardless of whether she is `OFFLINE` (unmatched-ring fallback) or `AVAILABLE`-but-gone (push
  is fire-and-forget; the kiosk times out to apology). Push never blocks a call.
- **Timesheet self-heals** — her next **Go on duty** close-then-inserts (`openShift` →
  `closeOpenShiftForUser` at her real `priorLastSeen`), stamping the lingering shift's `ended_at`
  accurately, usually within a day; admins can also edit/delete shifts.
- **Read-time timesheet is already accurate** — `computeClockedSeconds` caps a still-open stale
  shift at `last_seen_at`, so the displayed clocked time is correct before the cron closes the row.

Promptness of cleanup is a **cadence** lever, not a threshold one. Because the cron now acts only
on the abandon horizon, tightening its schedule later (spec §10 of the shift-tracking design,
`*/15` on the box) becomes **safe** — it would run often but still only sweep genuinely-abandoned
agents. This change does not alter the schedule; it unblocks that future tightening. (Do **not**
tie promptness to shortening `SHIFT_ABANDON_AFTER_MS` — that re-introduces the bug.)

## 4. Changes

### 4.1 `packages/shared/src/protocol.ts`
- Add `export const SHIFT_ABANDON_AFTER_MS = SESSION_MAX_MS;` with a doc comment stating the
  derivation (the minimum horizon that fires only after session death) and that it is the cron's
  shift-close / `OFFLINE`-flip cutoff, deliberately distinct from `PRESENCE_STALE_AFTER_MS`
  (read-time reachability).
- Module-load invariant guard: `SHIFT_ABANDON_AFTER_MS >= PRESENCE_STALE_AFTER_MS` (the abandon
  horizon must never be shorter than the reachability-staleness horizon), mirroring the existing
  reaper > ring-window guard.

### 4.2 `apps/portal/app/api/cron/mark-stale-offline/route.ts`
- Import `SHIFT_ABANDON_AFTER_MS` instead of `PRESENCE_STALE_AFTER_MS`.
- `const cutoff = new Date(Date.now() - SHIFT_ABANDON_AFTER_MS).toISOString();`
- Update the comment to explain the cutoff is the **abandon** horizon (genuinely gone), not the
  90s reachability staleness, and why (read-time paths own reachability; the raw-status flip must
  not silence a throttled-but-working agent's push).
- Everything else unchanged: `.lt("last_seen_at", cutoff).neq("status","OFFLINE").select(...)`,
  `closeOpenShiftForUser` per swept row, per-operator `recordHeartbeat` self-report.

### 4.3 Docs
- `docs/specs/2026-07-12-admin-shift-time-tracking-design.md` §10: note that tightening the
  presence sweep cadence is now safe because the sweep acts on `SHIFT_ABANDON_AFTER_MS`, not
  `PRESENCE_STALE_AFTER_MS`.

**No schema change. No new route. No RLS change. No cron-schedule change. No auth-flow change.**

## 5. Tests (TDD)

- **`packages/shared/tests/protocol.test.ts`**: `SHIFT_ABANDON_AFTER_MS === SESSION_MAX_MS`; the
  invariant `SHIFT_ABANDON_AFTER_MS >= PRESENCE_STALE_AFTER_MS` holds.
- **`apps/portal/tests/app/cron-offline.test.ts`** (the key regression): capture the ISO passed to
  `.lt("last_seen_at", cutoff)` and assert `Date.now() - Date.parse(cutoff) ≈ SHIFT_ABANDON_AFTER_MS`
  (12h ± tolerance), proving the cron cuts at the abandon horizon — i.e. a 90s/2h-stale (throttled,
  working) agent is **not** swept. Existing sweep/close-shift assertions stay green (a >12h-stale
  swept row still flips `OFFLINE` and closes its shift at its own `last_seen_at`).

## 6. Out of scope (noted, not changed)

- **Read-time clocked-time display** for a still-open stale shift freezes at `last_seen_at`
  (`computeClockedSeconds`) and will now apply over a longer window (shifts stay open until the
  abandon horizon). This is existing, intended behaviour (spec §9.2); it self-corrects on her next
  beat or when the shift closes. Not changed here.
- The `classifyShiftEnd` `capped`-vs-`lapsed` labelling limitation (already documented in
  `lib/shifts/lifecycle.ts`) is unaffected.
- The cron **cadence** (`*/15` on the box) — this design makes it safe but does not change it.
