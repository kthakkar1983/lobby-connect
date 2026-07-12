# Admin shift + time tracking — design

**Date:** 2026-07-12
**Status:** DRAFT — brainstorm complete, awaiting spec review → plan
**Mockup:** interactive states + admin view (see session artifact "Lobby Connect — shift tracking mockup")

## 1. What this is

An **admin-facing shift / utilization tracker**. "Go on duty" and "End shift" already act as clock-in / clock-out; today none of that is persisted, so we add a durable, **editable** shift record and an admin page that shows **hours clocked vs. hours of actual work** per person. The purpose is not payroll — it's so Kumar can see occupancy (clocked time against calls + talk-time + remote sessions) and use it to decide how to shuffle agents/properties between pods and set wages.

Alongside the record, "Go on duty" becomes a **hard gate**: an agent (or admin) cannot answer a call or remote into a hotel PC without a live shift. That guarantee is what makes the clocked-vs-worked numbers complete — no un-clocked work leaks through.

### Goal

- Persist every on-duty period as an editable `shifts` row (start, end, how it ended).
- Enforce, server-side, that all work (call answer, RustDesk Connect) requires a live shift.
- Add a first-class **On break** state (clocked in, not working, hard-gated) with its intervals tracked.
- Cap runaway shifts via a **12h session time-box** that auto-signs-out and thereby auto-clocks-out.
- Ship an **admin-only** page (new left-rail item between Audit log and Status) that shows per-shift clocked-vs-worked with utilization, `ended_reason`, and full editing.

### Non-goals (explicit)

- **No owner-facing view** in this iteration. The shift→property (pod-coverage) mapping is a clean future seam, not built now. (See §12.)
- **No dashboard layout changes** for agents or admins beyond: (a) the duty control moves into the shared header, (b) the duty buttons leave the softphone. Everything else on both dashboards is untouched.
- **No agent-facing utilization/idle breakdown.** Agents see only their running shift timer in the header. Fixed-salary agents must not see tracking/idle language (it reads as surveillance). The breakdown is admin-only.
- **Not payroll.** No pay rules, no approval workflow, no export in v1 (CSV export is a trivial later add).

## 2. Decision log

- **D1 — Consumer: admin only.** Owner-share deferred with a seam. (Kumar, this session.)
- **D2 — Capture: presence-derived, stored as first-class editable `shifts` rows** (Approach A). The existing duty transitions write shift open/close events; the shift is a durable entity, not recomputed on the fly. Admins can edit/delete/add. (Rejected: a separate explicit clock-in/out — double bookkeeping; pure manual admin entry — no auto-capture.)
- **D3 — "Actual work" = calls handled + talk-time + remote-connect count.** Talk-time is the only work *duration* we can measure; calls and remote-connects are counts shown alongside. Remote-session *duration* is unmeasurable (LC can't tell when RustDesk closes) and is NOT fabricated.
- **D4 — Hard gate, enforced server-side.** UI disabling is defense-in-depth only; the guarantee lives on the routes.
- **D5 — Duty control in the shared header, constant-size across all states.** Removed from the softphone.
- **D6 — Break: first-class `BREAK` state.** Shift keeps running (still clocked, session alive), hard-gated (no calls, no Connect), interval tracked. Neutral, non-tracking copy on the agent side.
- **D7 — 12h Supabase session time-box drives the max-shift cap.** Session expiry → heartbeat 401 → presence lapses → shift auto-closes at last heartbeat. Start at 12h, tighten later. One lever doubles as security (no perpetual sessions).
- **D8 — `ended_reason` ∈ {`manual`, `lapsed`, `capped`}.** Surfaced in the timesheet. `capped` vs `lapsed` distinguished by close-time duration near the 12h ceiling. Admin corrections stamp `edited_by`/`edited_at` and the shift keeps its original reason (the edit trail is separate from how it ended).
- **D9 — `ended_at` is always the last heartbeat time**, never "now", for non-manual closes — so duration is accurate regardless of when the close is detected.

## 3. Data model

Three DDL changes in one migration, **`supabase/migrations/0021_shift_tracking.sql`** (next free number confirmed; prod is at 0020).

### 3.1 `shifts`

```
shifts
  id            uuid pk default gen_random_uuid()
  operator_id   uuid not null references operators(id)      -- tenancy (decision #6)
  user_id       uuid not null references auth.users(id) on delete cascade
  started_at    timestamptz not null default now()
  ended_at      timestamptz null                            -- null = open/live shift
  ended_reason  text null check (ended_reason in ('manual','lapsed','capped'))
  edited_by     uuid null references auth.users(id) on delete set null
  edited_at     timestamptz null
  created_at    timestamptz not null default now()
```

- **One-open-shift invariant** (temporal-row pattern, mirrors `property_assignments`): partial unique index `shifts_one_open` on `(user_id) where ended_at is null`. A concurrent double-open hits `23505` → treated as "already open," no error surfaced.
- Indexes: `(operator_id, started_at desc)` for the timesheet query; `(user_id, started_at desc)` for per-user lookups.
- `ended_reason` is null while open; set on close. `edited`/`edited_by`/`edited_at` populated on admin correction.

### 3.2 `shift_breaks`

```
shift_breaks
  id          uuid pk default gen_random_uuid()
  shift_id    uuid not null references shifts(id) on delete cascade
  started_at  timestamptz not null default now()
  ended_at    timestamptz null                    -- null = break in progress
  created_at  timestamptz not null default now()
```

- Partial unique index `shift_breaks_one_open` on `(shift_id) where ended_at is null` (one open break per shift).
- Multiple breaks per shift allowed. Break time is tracked for the admin breakdown; the agent never sees "recorded" language.

### 3.3 `BREAK` status

Widen the `profiles.status` CHECK (from `0006`) to add `BREAK`:

```
alter table profiles drop constraint <status_check>;
alter table profiles add constraint <status_check>
  check (status in ('AVAILABLE','ON_CALL','AWAY','BREAK','OFFLINE'));
```

### 3.4 RLS

- `shifts` + `shift_breaks`: **service-role for all automated writes** (open/close/break) — consistent with "all presence writes are service-role" (the `0012` column guard blocks user-scoped `status` writes). Admin **SELECT/UPDATE/INSERT/DELETE** is **operator-scoped** (mirrors the `property_assignments` / owner-write policy pattern; use a `SECURITY DEFINER` operator-check helper to avoid RLS recursion). Agents get **no** direct `shifts` RLS — the agent header timer comes from the presence route (§6.2), not a client read.
- Follow the D14 storage posture where relevant, but these tables hold no secrets, so standard operator-scoped RLS is fine.

## 4. Duty-state model changes

All presence predicates live in `apps/portal/lib/voice/presence.ts` (+ mirrors). Changes:

- `LIVE_STATUSES` → add `BREAK`. A `BREAK` shift is still a **live shift** (clocked in); `isLiveShift()` stays true on break. A *stale* `BREAK` (heartbeat lapsed) collapses to `OFFLINE` like any other, closing the shift.
- `isLiveStatus()` (what a browser may self-set) → add `BREAK` (she sets it when taking a break) and keep `OFFLINE` server-only.
- `isReachableForDial()` — unchanged in effect: it already returns true only for `AVAILABLE`(/`ON_CALL`), so `BREAK` is never dialed.
- `isVideoSilencedStatus()` (`lib/push/targets.ts`) → add `BREAK` to the deny-list, so video does not ring on break. (Stays a deny-list — fails open on a status blip, never silences a live agent.)
- **New predicate `canDoWork(status, lastSeenAt, nowMs)`** = `isLiveShift(...) && status !== 'BREAK'`. This is the hard-gate predicate: on duty **and** not on break. Pure, unit-tested.

## 5. Shift lifecycle — the write seams

Four existing presence seams gain a shift side-effect. All are **service-role**; the cron is the robust backstop so a missed client-side close is always reconciled.

1. **Go on duty** (`POST /api/presence/go-on-duty`): after setting `AVAILABLE`, **open a shift** — insert `(operator_id, user_id, started_at=now())` **iff** no open shift exists for the user (idempotent; the partial unique index enforces it). A refresh/second call while already on duty is a no-op.
2. **End shift** (`POST /api/presence/end-shift`): after setting `OFFLINE`, **close the open shift** — `ended_at=now()`, `ended_reason='manual'`. Also close any open `shift_breaks` row (`ended_at=now()`).
3. **Heartbeat lapse-persist** (`POST /api/presence`, the block that flips a stale live row to `OFFLINE`): **close the open shift** — `ended_at = last_seen_at` (the true last-alive time), reason via `classifyShiftEnd` (§5.1). Close any open break. Best-effort (fail-open path stays fail-open); the cron reconciles.
4. **Cron sweep** (`GET /api/cron/mark-stale-offline`): for every row it flips to `OFFLINE`, **close the matching open shift** — `ended_at = last_seen_at`, reason via `classifyShiftEnd`. Close any open break. This is the guaranteed backstop, especially for session-expiry closes (heartbeat 401s can't self-persist).

**Break seams** (new routes, symmetric with go-on-duty/end-shift):

5. **Take a break** (`POST /api/presence/take-break`): set `status=BREAK`, open a `shift_breaks` row. Requires an open shift.
6. **Resume** (`POST /api/presence/resume`): set `status=AVAILABLE`, close the open `shift_breaks` row.

### 5.1 `capped` vs `lapsed`

Pure helper `classifyShiftEnd(startedAt, endedAt, capMs)`: if `(endedAt - startedAt) >= capMs - EPSILON` (near the 12h ceiling) → `'capped'`, else `'lapsed'`. The 12h session expiry manifests as a lapse; this labels it without extra machinery. `capMs`/EPSILON live in `packages/shared/src/protocol.ts` (new `SESSION_MAX_MS = 12h`, `SHIFT_CAP_EPSILON_MS`).

## 6. Session time-box + agent header timer

### 6.1 The 12h cap (ops, not code)

Set Supabase Dashboard → Auth → Sessions → **"Time-box user sessions" = 12 hours** (43200s), all roles. No app code implements the cap. Effect: 12h after login the session is invalid → heartbeat POSTs 401 → `last_seen_at` freezes at the last good beat → presence lapses → cron (§5.4) closes the shift `capped` at `last_seen_at`. This also forces a fresh sign-in + re-arm each shift (security win). Recorded in the credentials/ops runbook.

> ⚠ The 12h clock starts at **login**, not "Go on duty," and is a hard cutoff (mid-call possible). 12h is a comfortable ceiling over expected shift lengths; revisit the number if real shifts approach it.

### 6.2 Agent header timer

`GET /api/presence` gains a `shiftStartedAt` field (service-role read of the open shift). The header duty pill renders elapsed = `now - shiftStartedAt`. No agent RLS on `shifts` needed. A precise "session ends in …" countdown needs the box-end time, which Supabase doesn't cheaply expose client-side, so **v1 omits the live countdown** (the auto-clock-out still happens either way). Revisit only if we decide to persist a login timestamp.

## 7. The hard gate

### 7.1 Server-side (the guarantee)

Add a `canDoWork` check (§4), resolved from the actor's **current** `profiles.status`/`last_seen_at`, to:

- **`GET /api/remote-access/[propertyId]`** — the big hole today (Connect is fully ungated). Off-duty or on-break → **403** ("Go on duty to start your shift"), no credentials issued, no `credentials_issued` audit.
- **`POST /api/calls/[id]/answer-video`** — currently role+operator only. Add `canDoWork` → 403 if not workable.
- **`acceptCall`** (softphone) — audio is practically gated by dial, but add a `canDoWork` guard for the "call ringing when she flipped off/break" edge. (Server side has no accept route; guard client-side + rely on dial gating. Low-risk edge.)

### 7.2 Keep-alive (the risk we must handle)

Hard-gating Connect on live presence collides with the known throttle bug **`task_71d65b0a`** (the heartbeat is throttled while RustDesk is foregrounded). A genuinely-working agent whose heartbeat lapsed could be 403'd mid-session. Mitigations in this design:

- **A successful `remote-access` GET refreshes `last_seen_at`** (service-role), i.e. **Connect acts as a heartbeat** — each Connect extends the shift.
- `ON_CALL` already bypasses the duty gate, so live calls keep presence.
- **Residual risk:** a long remote session with **no calls and no new Connects** while the portal tab is throttled below the 90s staleness window. This is the `task_71d65b0a` bug. **Companion fix (flagged, may be prerequisite):** harden the background heartbeat (e.g. a keep-alive that survives RustDesk-foreground throttling) and/or widen staleness during an active remote session. Track alongside `task_71d65b0a`. The spec does not close this bug; it must not regress it into a hard 403.

### 7.3 UI (defense-in-depth + UX)

`onDuty`/`status` is currently trapped in the softphone (deliberately, to avoid render loops). Expose duty state to the header + work surfaces via a **small dedicated context** (`DutyProvider`, hydrated from `GET /api/presence`, updated by the duty actions) — NOT by lifting into `CallSurfaceProvider` (keep the render-loop firewall). Then:

- Header duty control reads it (§8).
- `ConnectButton` and the video host read it to show a gated state ("Go on duty to start") instead of erroring. The server 403 remains the real lock.

## 8. UI changes (constrained scope)

### 8.1 Header duty control (moves here from the softphone)

In the shared gradient `DashboardHeader` (both agent + admin), right side. **Constant-size control (fixed footprint) across all states** so nothing resizes:

- **Off duty** → "Go on duty" (mint).
- **On duty** → live pill: `On duty · Hh Mm` (running), "Take a break", `⋯` menu (End shift).
- **On break** → pill: `On break · Mm`, "Resume", `⋯` (End shift). Neutral copy only.
- **On a call** → pill: `On a call · MM:SS`; break hidden (can't break mid-call).

### 8.2 Softphone

Remove the `DutyControls` (Go on duty / End shift) rendering from `components/softphone/softphone.tsx`. Duty now lives in the header. The softphone keeps the phone line + the **Accepting calls** toggle (that's `AWAY`, distinct from break). Duty state that the softphone still needs (heartbeat gating) reads from the shared `DutyProvider`.

### 8.3 Gated work surfaces

When off-duty or on-break, the work surfaces (phone line / Connect / video) render a gated panel ("locked until you go on duty" / "resume when you're ready"). Blur/disable the underlying controls. This is the visible face of the §7.1 server gate.

### 8.4 What does NOT change

Both dashboards' bento/stats/recent-calls/charts are **untouched**. No agent-facing utilization or idle breakdown. No new agent nav.

## 9. Admin timesheet page

### 9.1 Route + nav

New route **`/admin/shifts`** (label **"Shifts"**, icon `Clock`), inserted in `ADMIN_NAV` (`components/app-sidebar.tsx`) **between "Audit log" and "Status"**. *(Route/label are my call — easy to rename to `/admin/timesheets` / "Timesheets" / "Hours" if preferred.)* Server component fetches; a `"use client"` table owns editing dialogs (standard admin-page pattern).

### 9.2 Data + metrics

Per-shift row = one `shifts` row joined with work metrics over its `[started_at, ended_at)` window:

- **Calls handled**: count of `calls` where `handled_by_user_id = user_id` and `answered_at` in window.
- **Talk-time**: sum of `calls.duration_seconds` for those calls.
- **Remote sessions**: count of `audit_logs` where `actor_user_id = user_id`, `action = 'remote_access.credentials_issued'`, `created_at` in window. (Prewarm vs connect distinguishable via `details.trigger` if we want "real" connects only.)
- **Clocked**: `effectiveEnd - started_at` where `effectiveEnd = ended_at ?? min(now, effectiveEndFromPresence)` — for a still-open-but-stale shift the read applies the same lapse logic, so durations are accurate even before the cron closes the row.
- **Break-time** (optional column / detail): sum of `shift_breaks` intervals.
- **Utilization = talk-time ÷ clocked** (the only honest duration ratio). Calls + remote shown as **counts** beside it — deliberately not folded into the ratio (no fabricated remote duration). *(Definition is my call; flag if you want it computed differently.)*

Pure, unit-tested helpers in `lib/shifts/` (or `lib/dashboard/`): `computeClockedSeconds`, `computeUtilization`, `summarizeShiftMetrics`, `classifyShiftEnd`.

### 9.3 Editing (audited)

Admins can **edit** `started_at`/`ended_at`, **delete** a bogus shift, and **add** a missed shift. Each stamps `edited_by`/`edited_at` (the shift keeps its original `ended_reason`) and writes an audit row. New audit actions in `lib/audit/actions.ts`: `SHIFT_EDITED`, `SHIFT_DELETED`, `SHIFT_CREATED_MANUAL`. (Automated open/close stay **unaudited** — the `shifts` table is the record; consistent with "presence writes are never audited." Only admin corrections are audited.)

### 9.4 Layout

Summary strip (clocked this period / actual work / fleet utilization / shifts capped) + per-shift table (agent, shift start–end, clocked, calls, talk, remote, utilization bar, `ended_reason` chip). Period selector (default this week; week nav or range). Matches the mockup.

## 10. Presence cron cadence

Currently the presence sweep is **daily** (`0 8 * * *`, a Vercel-Hobby leftover). On the box (Coolify, no Hobby limit) tighten the **presence** sweep to **~every 15 min** so lapsed/capped shifts close promptly in the timesheet. Update the Coolify `lc-ops` cron + `CRON_SWEEP_INTERVAL_MS` in `protocol.ts`. (Belt-and-suspenders with §9.2's read-time effective-end, so freshness never depends solely on cron cadence.)

## 11. Testing

TDD the pure logic before wiring (project convention):

- `canDoWork` predicate (on-duty/break/away/offline/stale matrix).
- `classifyShiftEnd` (capped vs lapsed boundary).
- Shift open idempotency (no duplicate open shift).
- `computeClockedSeconds` incl. still-open-stale effective-end.
- `computeUtilization` / metrics aggregation.
- Break interval open/close + close-on-shift-end.
- Route gate tests: `remote-access` + `answer-video` return 403 off-duty/on-break; Connect keep-alive refreshes `last_seen_at`.

## 12. Out of scope / seams

- **Owner-share** (pod-coverage mapping shift→properties): the `shifts.user_id` + `property_assignments` join is the seam; nothing built now.
- **Break column visibility** in the admin view is optional; data is captured regardless.
- **Remote-work duration**: unmeasurable (LC can't detect RustDesk close — the v2 "continue/disconnect prompt" gap). Only session *counts* are recorded.
- **CSV export / pay rules / approval workflow**: later.
- **Companion:** `task_71d65b0a` heartbeat hardening (see §7.2) — must land with or before the Connect hard gate.

## 13. Open items flagged for review

1. Route/label: `/admin/shifts` "Shifts" — good, or `/admin/timesheets` / "Hours"?
2. Utilization definition = talk-time ÷ clocked (counts shown separately) — good?
3. Is the §7.2 residual (long remote session, throttled heartbeat) worth hardening *in this feature*, or ship the Connect keep-alive + track `task_71d65b0a` separately?
