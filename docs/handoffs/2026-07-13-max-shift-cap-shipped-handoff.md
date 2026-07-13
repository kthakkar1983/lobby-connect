# Handoff — App-level max-shift cap SHIPPED (10h); shift-tracking free-tier backstop complete (2026-07-13)

**START HERE.** The app-level max-shift cap is built, adversarially reviewed, fixed, and **merged to `main` → prod** (Coolify auto-deploys; the daily presence cron picks it up on its next run). This closes the last free-tier gap in shift-tracking. This doc supersedes `2026-07-13-shift-tracking-live-duty-raw-status-handoff.md`; the cutover handoff (`2026-07-09-cutover-executed-live-handoff.md`) stays the live-prod infra reference.

## TL;DR

- **Max-shift cap shipped.** The daily presence sweep (`GET /api/cron/mark-stale-offline`) now ALSO force-closes any open shift that has run past **`MAX_SHIFT_MS = 10h`**, regardless of heartbeat staleness — the free-tier stand-in for Supabase's deferred 12h "Time-box user sessions" cap (Pro-only). This fixes the one gap the missing session cap left: a **forgotten shift on an AWAKE, still-beating machine** never goes stale, so the 12h abandon sweep never caught it → clocked hours inflated unbounded. Now it's bounded at 10h.
- **10h is Kumar's call** — a deliberately tight ceiling just past a full night shift. The app cap is now the PRIMARY ceiling (fires *before* the 12h session cap, which becomes a redundant outer backstop if/when Pro is enabled).
- **Built TDD + adversarial multi-agent review** (3 lenses → verify). The review found **1 medium + 5 low**; **all 6 fixed and mutation-verified** (see below). No findings left open.
- **Remaining time-tracker item = the UI/UX header polish batch (b + c only).** Deferred to the end by Kumar. Placement change (a) was **DECLINED** — the duty control stays top-right.

## What shipped (code)

| File | Change |
|---|---|
| `packages/shared/src/protocol.ts` | `MAX_SHIFT_MS = 10 * 60 * 60 * 1000` (+ doc comment). Module-load guard = `MAX_SHIFT_MS > PRESENCE_STALE_AFTER_MS` (the old `> SESSION_MAX_MS` guard would have crash-thrown at 10h < 12h). |
| `apps/portal/lib/shifts/store.ts` | New `capOverlongShifts(admin, nowMs): Promise<number>` — the cap logic (flip-first-then-close). |
| `apps/portal/app/api/cron/mark-stale-offline/route.ts` | Calls `capOverlongShifts(admin, Date.now())` **after** the abandon sweep, before the operator self-report. |
| tests | `protocol.test.ts`, `store.test.ts` (cap block rewritten), `cron-offline.test.ts`, `cron/heartbeat.test.ts` (mock extended). |
| `docs/specs/2026-07-13-app-level-max-shift-cap-design.md` | Full design doc (decisions, the flip-first fix, the break clamp, tests). |

**Gate at merge:** 770 node + 183 jsdom + 34 shared = **987 tests**, typecheck, lint (full — worktrees cleared), `check:routes` — all green.

## Design decisions (locked)

- **Ceiling anchoring.** A capped shift's `ended_at = started_at + MAX_SHIFT_MS` (the ceiling) — **never** `now` or the fresh `last_seen_at`, both of which grow with cron cadence and would re-introduce the very inflation the cap exists to stop. `ended_reason = 'capped'` (stamped directly — sidesteps `classifyShiftEnd`'s session-vs-shift labeling quirk).
- **Flip-first gate (the fix for the medium bug).** Per over-cap shift: flip the agent `OFFLINE` **first** (`.eq("id",user_id).neq("status","ON_CALL").select("id")`), and **only close the shift if that flip took rows**. An `ON_CALL` agent (0-row flip) or a flip error → the shift stays **OPEN** and the next sweep re-caps her once the call ends. This is what avoids stranding an on-call agent with a *closed* shift but on-duty raw-status (an un-clocked, un-re-catchable work window). The flip is also what stops un-clocked work leaking generally — `canDoWork` is raw-status, so an `AVAILABLE`-but-shiftless agent would otherwise still be sent work with nothing tracking it.
- **Ordering: abandon sweep BEFORE the cap.** A shift that is both stale-past-12h and over-10h closes at its accurate `last_seen_at` (`lapsed`), not the ceiling. `.is("ended_at", null)` first-writer-wins guards keep it corruption-free either way; ordering just wins the labeling accuracy.
- **Break clamp.** Any open break closes at `max(break.started_at, ceiling)` so a break OPENED past the ceiling can't get `ended_at < started_at` (a negative-duration row — no DB CHECK guards it).

## Adversarial review — the 6 findings, all fixed + mutation-verified

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| 1 | med | ON_CALL agent's shift closed but not flipped → stranded, unbounded un-clocked work | **Flip-first gate** (above) — on-call agent skipped whole, shift stays open, re-capped next sweep |
| 3 | low | Break opened *after* the ceiling → negative-duration row | Break closes at `max(started_at, ceiling)` |
| 2/4 | low | Cron test's OFFLINE-flip assertion vacuous (abandon sweep already flips) | Assert the cap flip's `.eq("id",user_id)` — a chain the abandon sweep never uses |
| 5 | low | Break-close guard (`.eq/.is`) unpinned in the store test | Added spies + assertions on break-close scoping + first-writer-wins guard |
| 6 | low | Ordering (abandon-before-cap) untested | Added an invocation-order assertion (`ltSpy` before `capLtSpy`) |

**Mutation-verified** the two previously-vacuous tests now catch regressions: reversing the cron order → ordering test FAILS; scoping the flip to a wrong user → both flip tests FAIL.

## Prod state

- **`main`** now carries the cap. Coolify auto-deploys `lc-portal-prod` from `main`; the cap runs inside the existing daily presence cron on `lc-ops` (no new cron, no schedule change). **No migration, no RLS, no new route** — pure additive logic. The frozen Vercel/Agora standby is untouched (instant rollback).
- Expect `ended_reason` on prod shifts: mostly `manual` (End shift) and `lapsed` (asleep machine, abandon sweep); **`capped` now actually appears** for awake-forgotten shifts hitting 10h (previously near-impossible without the session cap).

## OUTSTANDING — next chat

1. **UI/UX header polish batch (b + c)** — the remaining time-tracker polish. Read `components/dashboard/duty-control.tsx` + `components/account-menu.tsx`. **(b)** the duty pills aren't consistently sized — unify one pill "shell" (shared height/min-width/type) across off / on-duty / on-break, and match button sizes across states; consider adding "On break · Mm" for parity with "On duty · Hh Mm". **(c)** "End shift" and "Sign out" share the `LogOut` icon (reads as a duplicate across the two header menus) — give "End shift" its own icon (e.g. `TimerOff`), keep `LogOut` for Sign out. **Placement (a) was DECLINED** — leave the duty control top-right next to the avatar. Fold in `[[dashboard-layout-rework-deferred]]` if doing a broader pass.
2. **Broader deferred agenda** (own brainstorm each): **outbound calls** on the agent dashboard + pod attribution (which `property_id` the outbound leg bills to); attention-aware dormant/wake call tile + RustDesk true-fullscreen SOP; credential-hardening (encrypt-at-rest + fail-closed issuance audit) = pre-second-hotel.

## Repo hygiene / gotchas

- **Stale worktrees CLEARED** this session (`epic-cray-b9f907`, `sleepy-lamarr-b1f2f0`) — full `pnpm lint` is clean again.
- ⚠ **Spurious `… 2.ts/tsx/md/sql` duplicate files** appeared in the working tree (macOS/iCloud "file already exists" copies of the tracked shift-tracking files, e.g. `store 2.ts`, `duty-control 2.tsx`, `0021_shift_tracking 2.sql`). They are **untracked, inert** (Next/vitest don't pick up `… 2` names) and were **NOT committed**. Safe to delete (`git clean -n` first to preview). The project lives under iCloud-synced `~/Documents`, which is the likely source — worth watching.
- The architecture-audit folder `analysis-and-audit-2026_07_11/` (docs 00–11) remains **deliberately uncommitted** ([[chat-feature-direction]]).
- **Lesson:** never `git checkout <file>` to "restore" a mutation on a file with UNCOMMITTED changes — checkout reverts to HEAD and silently discards the working-tree work. Use a `cp` backup instead (as done for `route.ts` during mutation testing).
