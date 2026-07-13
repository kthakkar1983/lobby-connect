# Handoff — Shift-tracking LIVE on prod; duty is raw-status; cron abandon-horizon fix (2026-07-13)

**START HERE.** Admin shift/time-tracking is now **live on the prod pilot**, plus two follow-up fixes shipped the same session. This doc is the current source of truth; the cutover handoff (`2026-07-09-cutover-executed-live-handoff.md`) stays the live-prod infra reference.

## TL;DR

- **Shift-tracking feature merged + deployed to prod** (migration `0021` applied to prod Supabase, code on `main`, Coolify auto-deployed).
- **The one HIGH bug an adversarial review caught pre-merge is fixed:** duty is now **raw-status, not staleness**, so a heads-down agent whose portal heartbeat lapses behind foregrounded RustDesk is no longer 403'd on a pushed guest video call.
- **Two smoke/follow-up fixes shipped in a second deploy:** (1) Resume/Go-on-duty now re-fetch incoming video immediately; (2) the presence sweep cron abandons a shift at the **12h session cap**, not 90s staleness.
- **Open for Kumar:** set the Supabase **12h session time-box** (still `0` = never), smoke the two follow-up fixes, and a small **UI/UX header polish batch**.

## What shipped this session (in order)

| Commit | What |
|---|---|
| `64b6d90` | **Duty raw-status fix** — `canDoWork(status)` blocks only OFFLINE/BREAK (was staleness-based); `requireOnDuty` + GET `/api/presence` hydration follow suit; heartbeat refreshes any non-OFFLINE shift (dropped the `.gte` staleness guard, removed the lapse-persist branch); `isLiveShift` deleted; `video-call` answer failures now Sentry-log instead of closing silently. |
| `987226b` | **Merge `shift-time-tracking` → `main`** — the whole admin timesheet feature (see the merge's own history for the 37-commit feature build). First prod deploy of shift-tracking. |
| `e8c442e` | **Resume-refetch fix** — `DutyProvider.resume()`/`goOnDuty()` dispatch a `lib/duty/duty-events.ts` window event; the incoming-video hook re-ticks on it, so a call ringing while she was on break/off-duty surfaces the instant she comes back (was: only on the 60s fallback poll / manual refresh). |
| `bf70367` | **Cron abandon-horizon fix** (task_71d65b0a, the fork) — `SHIFT_ABANDON_AFTER_MS = SESSION_MAX_MS` (12h); the presence sweep closes shifts at 12h, not 90s. |
| `af7b2d1` | **Merge the cron fix into `main`** — the second deploy (resume-fix + cron-fix). |

Migrations `0021` design/logic unchanged from the branch. **No new migration** in the two follow-up fixes — code only.

## Prod state (verified)

- **Supabase prod** (`ztunzdpmazwwwkxcpyfp`): at **0021** — `shifts` + `shift_breaks` tables, 5 indexes, 5 RLS policies, RLS on both, `BREAK` in `profiles_status_check`. Verified via MCP.
- **`main` = `af7b2d1`**, pushed → Coolify auto-deploys `lc-portal-prod` + `lc-kiosk-prod`. Frozen Vercel/Agora standby untouched = instant rollback (flip Twilio + tablet back).
- **Full gate green** at `af7b2d1`: typecheck, lint (0), 756 node + 183 jsdom + 32 shared = **971 tests**, check:routes.

## OUTSTANDING — do these next

1. **Kumar: set Supabase "Time-box user sessions" = 12h (43200s)** on prod. It's currently `0` = never. This is the abandoned-shift backstop the shift model relies on (an agent who forgets to End shift → session expires at 12h → heartbeats stop → the daily sweep closes the shift as `capped`). Applies from each login forward — no immediate disruption to a live session.
2. **Smoke the two follow-up fixes** (`af7b2d1`, once Coolify finishes): (a) go on break → call the kiosk → press **Resume** mid-ring → the incoming call should appear **instantly** (no hard refresh); (b) the cron change is verify-by-code (no easy live smoke) — it only affects the daily 04:00 sweep.
3. **UI/UX header polish batch** (flagged in smoke, not started): **(a)** header duty-button **placement**; **(b)** the duty pills are **not consistently sized**; **(c)** **End shift and Log out share the same icon** (reads as duplicate). This is the next work item — read `components/dashboard/duty-control.tsx` + the account menu + `dashboard-header`/`app-shell` first.

## Design decisions locked this session

- **Duty/shift-liveness = raw status; reachability = staleness.** The clean split: `canDoWork`/`requireOnDuty`/hydration read raw status (only OFFLINE/BREAK block); `effectivePresence`/`isReachableForDial` keep the 90s staleness test for dashboards + the outbound audio dial (a frozen tab genuinely can't take a Twilio leg — that asymmetry is intentional). Rationale: an agent works heads-down in RustDesk with the portal tab throttled/frozen, so a stale heartbeat is her NORMAL working state (the ring + Web Push paths already treat her as present).
- **Shift closers:** End shift (manual) · daily cron sweep at the **12h abandon horizon** (lapsed/capped) · the 12h session cap. A beat can never resurrect an ENDED shift (`.neq OFFLINE` stays; go-on-duty is the only OFFLINE→live door).
- **`SHIFT_ABANDON_AFTER_MS = SESSION_MAX_MS` (12h)** — the provably-safe minimum (a heartbeat can't precede login; the session dies at login+12h, so a >12h-stale agent is genuinely gone). Design: `docs/specs/2026-07-13-shift-abandon-cron-cutoff-design.md`.

## Known residuals / accepted tradeoffs

- **A gone-without-ending-shift agent stays a VIDEO target up to ~12h** (raw status stays AVAILABLE until the 12h sweep; `incoming-video`/push gate on raw status). Bounded, low-harm (her ring goes unanswered → apology / covering admin; audio dial already skips her via the 90s reachability gate). This is the correct bias for a dedicated-employee model — accepted.
- **Two LOW timesheet-integrity artifacts** from the pre-merge adversarial review (orphan open-shift on a transient DB error at End shift → phantom "On shift" badge, self-heals on next go-on-duty; ON_CALL two-tab resurrect under-reports hours). Not deploy-blocking; revisit if the timesheet numbers look off.

## Repo hygiene

- **Stale worktrees to remove** (leftover from background agents; they pollute local `pnpm lint` — `eslint .` descends into them, CI doesn't): `.claude/worktrees/epic-cray-b9f907` (has abandoned uncommitted edits — discard) and `.claude/worktrees/sleepy-lamarr-b1f2f0` (the now-merged cron fork — safe to `git worktree remove`). `frosty-heyrovsky-294b4a` was already removed this session.
- Branches merged this session: `shift-time-tracking`, `claude/sleepy-lamarr-b1f2f0` (both fully in `main`).
