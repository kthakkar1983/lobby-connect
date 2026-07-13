# App-level max-shift cap — design

**Date:** 2026-07-13
**Status:** design approved (Kumar, 2026-07-13); value `MAX_SHIFT_MS = 10h` (Kumar's call — a tight ceiling just past a full night shift; the app cap is the PRIMARY ceiling, below the deferred 12h session cap).
**Companion of:** `docs/specs/2026-07-13-shift-abandon-cron-cutoff-design.md` (the *staleness* horizon). This is the *shift-length* horizon.

## 1. Problem

Since `64b6d90` ("duty is raw-status, not staleness") and the abandon-horizon fix (`SHIFT_ABANDON_AFTER_MS = 12h`), the presence sweep only closes a shift when the agent's heartbeat is **stale** past 12h. That correctly leaves a heads-down, throttled-tab agent alone — but it also means a shift on a machine that **keeps beating** never closes on its own:

- The intended max-shift ceiling was Supabase's **"Time-box user sessions" = 12h** Auth setting (session dies → heartbeat 401s → presence lapses → shift auto-closes). That setting is **Pro-only** and is **deferred** until we upgrade.
- Without it, a **forgotten shift on an awake machine** (dashboard left open + on duty on a box that never sleeps) beats every ~20s forever → `last_seen_at` stays fresh → the abandon sweep never sees it → the shift never closes.

Result: clocked hours for that shift **inflate unbounded**. `computeClockedSeconds` only bounds an *open-but-stale* shift (it caps at `last_seen_at`); an open-and-**fresh** shift reads `now - started_at`, which grows without limit. So neither the cron nor the read-time display bounds this case. This is the one gap the missing session cap leaves.

## 2. Design

Add an **app-level, shift-anchored** cap enforced by the same daily presence sweep (`GET /api/cron/mark-stale-offline`). Independent of staleness: it force-closes any **open** shift whose `started_at` is older than `MAX_SHIFT_MS`, **regardless of how fresh the heartbeat is**.

Shift-anchored (measured from `shifts.started_at`), NOT login-anchored — so it needs no login timestamp (none is stored) and it **sidesteps** the `classifyShiftEnd` session-vs-shift labeling quirk (it stamps `capped` directly rather than inferring it from duration).

### 2.1 The value — `MAX_SHIFT_MS = 10h`

- **The PRIMARY max-shift ceiling** (Kumar's call). At 10h it fires *before* the deferred 12h Supabase session cap, so if that Pro setting is later enabled it becomes a redundant outer backstop, not the primary.
- **A tight ceiling just past a full night shift.** A genuine agent who runs past 10h is bounced off duty and re-Goes-on-duty for a fresh shift (two rows) — the correct bias for accurate clocked time.
- Module-load invariant only requires it outlast the 90s reachability staleness (`> PRESENCE_STALE_AFTER_MS`).
- One-constant tunable (`packages/shared/src/protocol.ts`).

### 2.2 What the cap does per over-cap open shift

The three writes run in a deliberate order — **flip OFFLINE FIRST, and the flip gates the close** — so an `ON_CALL` agent is skipped *cleanly* (not stranded). This ordering is what closes the review's medium finding.

1. **Flip the agent `OFFLINE` FIRST — excluding a live call** (`.update({status:"OFFLINE"}).eq("id",user_id).neq("status","ON_CALL").select("id")`). Flipping her off duty is the faithful app-level equivalent of the session cap forcing a re-sign-in, and it is what stops un-clocked work leaking generally: `canDoWork` is raw-status, so an `AVAILABLE`-but-shiftless agent would otherwise still be sent work with nothing tracking it. The **matched-rows result is the gate** for step 2/3.
2. **Only if the flip actually took** (she was not on a call) → **close the shift at the CEILING** (`ended_at = started_at + MAX_SHIFT_MS`, `ended_reason = 'capped'`). The ceiling — never `now` or the fresh `last_seen_at`, both of which grow with cron cadence and re-introduce the unbounded inflation — is the honest, bounded upper estimate (we can't know when a forgotten agent actually left; the ceiling is the conservative bound, and the exact hours a genuine 10h worker would have clocked). **If the flip took 0 rows (she is `ON_CALL`) or errored → skip the close entirely: the shift stays OPEN**, so the next sweep genuinely re-caps her once the call ends. This is the fix for the stranding bug: closing the shift *unconditionally* while skipping only the flip would leave an `ON_CALL` agent with a **closed** shift but on-duty raw-status, un-clocked and un-re-catchable (the scan only sees open shifts). Flip-first makes "skip the whole row for `ON_CALL`" the actual behavior. In practice a *forgotten* machine is idle (`AVAILABLE`/`AWAY`/`BREAK`), never `ON_CALL`, so the skip is rare.
3. **Close any open `shift_breaks`** for that shift at **`max(break.started_at, ceiling)`** — clamped so a break OPENED past the ceiling (a shift that ran past the cap in real time before the daily cron) can't get `ended_at < started_at`, a negative-duration row (there is no DB CHECK guarding it). A break started at/before the ceiling closes at the ceiling as expected.

Convergence after the flip is clean: the client hydrates `onDuty=false` from `GET /api/presence` on focus/mount, and the 20s heartbeat (`.neq("status","OFFLINE")` matches 0 rows) returns `{onDuty:false}` → her header flips to "Go on duty" within one beat. A beat can never resurrect the `OFFLINE` row (go-on-duty is the only door in).

### 2.3 Ordering: abandon sweep first, then cap

The two sweeps target different populations (staleness vs shift-length) but can overlap for a shift that is both stale-past-12h and over-10h-long. Run the **abandon sweep first** so such a shift closes at its accurate `last_seen_at` (`lapsed`), not the ceiling. Then run the cap on whatever open shifts remain — which are the awake-and-beating survivors. The `.is("ended_at", null)` first-writer-wins guard on every close means the outcome is corruption-free even if the order were reversed; ordering only decides *which* (more accurate) reason/`ended_at` wins.

## 3. Changes

### 3.1 `packages/shared/src/protocol.ts`
- `export const MAX_SHIFT_MS = 10 * 60 * 60 * 1000;` with a doc comment (purpose, ceiling semantics, that it is the PRIMARY ceiling firing before the deferred Supabase session cap, and that it is the free-tier stand-in for it).
- Module-load invariant: `MAX_SHIFT_MS > PRESENCE_STALE_AFTER_MS` (a shift-length ceiling must outlast the reachability-staleness window; mirrors the existing reaper>ring and abandon≥staleness guards).

### 3.2 `apps/portal/lib/shifts/store.ts`
- New `capOverlongShifts(admin, nowMs): Promise<number>` — queries open shifts started before `nowMs - MAX_SHIFT_MS`; per row **flips the profile `OFFLINE` first** (`.eq("id",user_id).neq("status","ON_CALL").select("id")`) and, **only if that flip took**, closes the shift at the ceiling (`capped`) and any open break at `max(break.started_at, ceiling)`. An `ON_CALL` agent (0-row flip) or a flip error skips the close, leaving the shift open for the next sweep. Best-effort per-write error logging (mirrors `closeOpenShiftForUser`). Returns the count actually capped.

### 3.3 `apps/portal/app/api/cron/mark-stale-offline/route.ts`
- After the existing abandon sweep + per-row `closeOpenShiftForUser`, and before the operator self-report, call `await capOverlongShifts(admin, Date.now())`.
- Update the header comment to note the second responsibility (the shift-length cap) alongside the staleness abandon.

**No schema change. No new route. No RLS change. No cron-schedule change. No auth-flow change.**

## 4. Tests (TDD)

- **`packages/shared/tests/protocol.test.ts`**: `MAX_SHIFT_MS === 10h`; `MAX_SHIFT_MS > PRESENCE_STALE_AFTER_MS`.
- **`apps/portal/tests/lib/shifts/store.test.ts`** (`capOverlongShifts`): cutoff passed to `.lt("started_at", …)` is ≈ `now - MAX_SHIFT_MS`; a returned over-cap row → **flips first** scoped `.eq("id",user_id).neq("status","ON_CALL")`, then shift closed `{ended_at: started_at+MAX_SHIFT_MS, ended_reason:"capped"}` scoped `.eq("id",id).is("ended_at",null)`; an open break closed at the ceiling scoped `.eq("id",breakId).is("ended_at",null)`, and a break started **past** the ceiling clamped to its own start (no negative duration); an **`ON_CALL` agent (0-row flip) → shift NOT closed, returns 0**; a flip error → no close; empty result / scan error → no writes, returns 0.
- **`apps/portal/tests/app/cron-offline.test.ts`**: over-cap open shift → cron closes it at the ceiling with `capped` and flips OFFLINE, pinned via the cap flip's **`.eq("id",user_id)`** (distinct from the abandon sweep's `.lt().neq()`, so the assertion is discriminating); the abandon sweep runs **before** the cap (invocation-order assertion); nothing over-cap → no cap writes.

## 5. Out of scope / accepted

- **A genuine >10h worker is bounced off duty at 10h** and must re-Go-on-duty (a fresh shift row). Expected and correct — 10h is a deliberately tight ceiling just past a full night shift, so a real long shift may occasionally trip it; the two-row split is accurate.
- The `ON_CALL`-at-10h skip (genuinely deferred one sweep — the shift stays open and re-caps once the call ends) — see §2.2.
- Cron **cadence** unchanged (daily). The ceiling anchoring makes the cap correct at any cadence; tightening to `*/15` on the box later is independently safe (per the abandon-cutoff design §3.2).
