# Admin shift + time tracking — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every on-duty period as an editable shift record, hard-gate all work (call answer + RustDesk Connect) behind a live shift, add a first-class "On break" state, cap runaway shifts via a 12h session time-box, and ship an admin-only timesheet page showing clocked-vs-worked utilization.

**Architecture:** Presence-derived shifts. The four existing duty transitions (go-on-duty / end-shift / heartbeat-lapse / cron-sweep) gain a shift open/close side-effect writing to a new `shifts` table (service-role, like all presence writes). A new `BREAK` status + `shift_breaks` child table track breaks. Duty state lifts out of the softphone into a new `DutyProvider` context so the header can own the duty control and `ConnectButton`/video-host can read gate state. A server-side `canDoWork` check on the two open work routes is the real gate; the UI mirrors it.

**Tech stack:** Next.js App Router (portal), Supabase (Postgres + RLS + service-role admin client), Vitest, TypeScript, Tailwind + shadcn.

**Spec:** `docs/specs/2026-07-12-admin-shift-time-tracking-design.md`. Read it first.

**Conventions that apply throughout (from CLAUDE.md):**
- Pure logic in `lib/` TDD'd with Vitest before wiring. Commit per task.
- All `profiles.status`/`last_seen_at`/shift writes are **service-role** (`createAdminClient()`) — the `0012` column guard blocks user-scoped `status` writes.
- Never hand-edit `packages/shared/src/database.generated.ts`; regenerate with `pnpm gen:types` (needs `supabase start` + Supabase CLI `2.101.0`).
- Typed routes: a new `/admin/shifts` literal href needs no cast once the page file exists.
- `pnpm test` / `typecheck` / `lint` / `check:routes` must stay green (CI gates them).
- Portal tests run from `apps/portal`: `pnpm --filter @lc/portal test <file>`.

---

## Phase A — Shift persistence (backend)

*Ships: every on-duty period is recorded as an editable `shifts` row that opens on go-on-duty and closes on end-shift, lapse, or cron sweep. Verifiable in the DB with no UI.*

### Task 1: Migration 0021 — tables, BREAK status, RLS, indexes

**Files:**
- Create: `supabase/migrations/0021_shift_tracking.sql`
- Modify: `packages/shared/src/supabase-types.ts`
- Modify (generated, via command): `packages/shared/src/database.generated.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0021_shift_tracking.sql`:

```sql
-- 0021_shift_tracking.sql — admin shift + time tracking (spec 2026-07-12).
-- Presence-derived shift records + a first-class BREAK status. Service-role for
-- all automated writes (0012 column guard blocks user-scoped status writes);
-- admins read/edit operator-scoped. Idempotent where practical.

-- 1. Widen the presence status CHECK to add BREAK (on duty, not working).
alter table profiles drop constraint if exists profiles_status_check;
alter table profiles add constraint profiles_status_check
  check (status in ('AVAILABLE', 'ON_CALL', 'AWAY', 'BREAK', 'OFFLINE'));

-- 2. shifts: one row per on-duty period. ended_at IS NULL = open/live.
create table if not exists shifts (
  id            uuid primary key default gen_random_uuid(),
  operator_id   uuid not null references operators(id),
  user_id       uuid not null references auth.users(id) on delete cascade,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  ended_reason  text check (ended_reason in ('manual','lapsed','capped')),
  edited_by     uuid references auth.users(id) on delete set null,
  edited_at     timestamptz,
  created_at    timestamptz not null default now()
);

-- One open shift per user (temporal-row invariant, mirrors property_assignments).
create unique index if not exists shifts_one_open
  on shifts (user_id) where ended_at is null;
create index if not exists shifts_operator_started
  on shifts (operator_id, started_at desc);
create index if not exists shifts_user_started
  on shifts (user_id, started_at desc);

-- 3. shift_breaks: intervals within a shift. ended_at IS NULL = break in progress.
create table if not exists shift_breaks (
  id          uuid primary key default gen_random_uuid(),
  shift_id    uuid not null references shifts(id) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists shift_breaks_one_open
  on shift_breaks (shift_id) where ended_at is null;

-- 4. RLS. Automated open/close/break are service-role (auth.uid() IS NULL ->
--    current_user_role() IS NULL, so no policy grants them; service role
--    bypasses RLS). Admins read + edit operator-scoped; agents get NO client
--    access (the header timer comes from GET /api/presence, not a client read).
alter table shifts enable row level security;
alter table shift_breaks enable row level security;

drop policy if exists "shifts_admin_select" on shifts;
create policy "shifts_admin_select" on shifts
  for select to authenticated
  using (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN');

drop policy if exists "shifts_admin_update" on shifts;
create policy "shifts_admin_update" on shifts
  for update to authenticated
  using (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN')
  with check (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN');

drop policy if exists "shifts_admin_insert" on shifts;
create policy "shifts_admin_insert" on shifts
  for insert to authenticated
  with check (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN');

drop policy if exists "shifts_admin_delete" on shifts;
create policy "shifts_admin_delete" on shifts
  for delete to authenticated
  using (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN');

-- shift_breaks: admin read only (edited via the parent shift). No client writes.
drop policy if exists "shift_breaks_admin_select" on shift_breaks;
create policy "shift_breaks_admin_select" on shift_breaks
  for select to authenticated
  using (
    current_user_role() = 'ADMIN'
    and exists (
      select 1 from shifts s
      where s.id = shift_breaks.shift_id
        and s.operator_id = current_user_operator_id()
    )
  );
```

Note: `current_user_operator_id()` and `current_user_role()` are the `0001` SECURITY DEFINER helpers (same shape used by `0004`/`0010`). The `exists` subquery on `shift_breaks_admin_select` reads `shifts` — `shifts` RLS is not recursive with `shift_breaks`, so no `0004`-style helper is needed here.

- [ ] **Step 2: Apply to local Supabase and regenerate types**

Run (needs Docker + `supabase start` running):
```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
supabase db reset   # or apply the single migration on your local stack
pnpm gen:types
```
Expected: `packages/shared/src/database.generated.ts` now contains `shifts` and `shift_breaks` table types, and `profiles` status remains a plain string in the generated base.

- [ ] **Step 3: Add the curated type overlay + aliases**

In `packages/shared/src/supabase-types.ts`:

Update the `ProfileStatus` union (near line 15) to add `BREAK`:
```ts
export type ProfileStatus = "AVAILABLE" | "ON_CALL" | "AWAY" | "BREAK" | "OFFLINE";
```
Add a `ShiftEndedReason` union near it:
```ts
export type ShiftEndedReason = "manual" | "lapsed" | "capped";
```
Add overlay entries inside `ColumnOverrides.public.Tables` (alongside `profiles`/`properties`), narrowing the CHECK column:
```ts
      shifts: {
        Row: { ended_reason: ShiftEndedReason | null };
        Insert: { ended_reason?: ShiftEndedReason | null };
        Update: { ended_reason?: ShiftEndedReason | null };
      };
```
Add named aliases at the bottom (after `OperatorSettings`):
```ts
export type Shift = Tables<"shifts">;
export type ShiftBreak = Tables<"shift_breaks">;
```
`shift_breaks` has no CHECK-narrowed column, so it needs no `ColumnOverrides` entry — only the alias.

- [ ] **Step 4: Verify typecheck + drift check**

Run:
```bash
pnpm --filter @lc/shared typecheck
pnpm gen:types:check
```
Expected: PASS (no drift; overlay compiles).

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/0021_shift_tracking.sql packages/shared/src/supabase-types.ts packages/shared/src/database.generated.ts
git commit -m "feat(shifts): migration 0021 — shifts + shift_breaks tables, BREAK status, RLS"
```

---

### Task 2: Protocol constants for the session cap

**Files:**
- Modify: `packages/shared/src/protocol.ts`
- Test: `packages/shared/src/protocol.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/protocol.test.ts`:
```ts
import { SESSION_MAX_MS, SHIFT_CAP_EPSILON_MS } from "./protocol";

it("session cap is 12h and epsilon is a sane sliver under it", () => {
  expect(SESSION_MAX_MS).toBe(12 * 60 * 60 * 1000);
  expect(SHIFT_CAP_EPSILON_MS).toBeGreaterThan(0);
  expect(SHIFT_CAP_EPSILON_MS).toBeLessThan(SESSION_MAX_MS / 10);
});
```

- [ ] **Step 2: Run it — expect FAIL** (`SESSION_MAX_MS` not exported).
```bash
pnpm --filter @lc/shared test protocol
```

- [ ] **Step 3: Add the constants** to `packages/shared/src/protocol.ts` (after `CRON_SWEEP_INTERVAL_MS`):
```ts
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
```

- [ ] **Step 4: Run test — expect PASS.**

- [ ] **Step 5: Commit**
```bash
git add packages/shared/src/protocol.ts packages/shared/src/protocol.test.ts
git commit -m "feat(shifts): SESSION_MAX_MS + SHIFT_CAP_EPSILON_MS protocol constants"
```

---

### Task 3: Pure shift helpers (`lib/shifts/lifecycle.ts`)

**Files:**
- Create: `apps/portal/lib/shifts/lifecycle.ts`
- Test: `apps/portal/tests/lib/shifts/lifecycle.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/portal/tests/lib/shifts/lifecycle.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { SESSION_MAX_MS } from "@lc/shared";
import {
  classifyShiftEnd,
  canDoWork,
  computeClockedSeconds,
  computeUtilization,
} from "@/lib/shifts/lifecycle";

const iso = (ms: number) => new Date(ms).toISOString();

describe("classifyShiftEnd", () => {
  it("near the cap is 'capped'", () => {
    const start = 0;
    const end = SESSION_MAX_MS - 60_000; // 1 min under 12h
    expect(classifyShiftEnd(iso(start), iso(end), SESSION_MAX_MS)).toBe("capped");
  });
  it("a short shift is 'lapsed'", () => {
    expect(classifyShiftEnd(iso(0), iso(3 * 60 * 60 * 1000), SESSION_MAX_MS)).toBe("lapsed");
  });
});

describe("canDoWork", () => {
  const now = 1_000_000_000_000;
  const fresh = iso(now - 10_000);
  it("AVAILABLE fresh -> true", () => expect(canDoWork("AVAILABLE", fresh, now)).toBe(true));
  it("AWAY fresh -> true (heads-down remote work allowed)", () => expect(canDoWork("AWAY", fresh, now)).toBe(true));
  it("ON_CALL fresh -> true", () => expect(canDoWork("ON_CALL", fresh, now)).toBe(true));
  it("BREAK fresh -> false (not working on break)", () => expect(canDoWork("BREAK", fresh, now)).toBe(false));
  it("OFFLINE -> false", () => expect(canDoWork("OFFLINE", fresh, now)).toBe(false));
  it("stale AVAILABLE -> false (shift lapsed)", () =>
    expect(canDoWork("AVAILABLE", iso(now - 5 * 60_000), now)).toBe(false));
});

describe("computeClockedSeconds", () => {
  const now = 100_000_000;
  it("closed shift = ended - started", () =>
    expect(computeClockedSeconds(iso(0), iso(3600_000), null, now)).toBe(3600));
  it("open fresh shift = now - started", () =>
    expect(computeClockedSeconds(iso(now - 3600_000), null, iso(now - 10_000), now)).toBe(3600));
  it("open STALE shift = lastSeen - started (effective end)", () =>
    expect(computeClockedSeconds(iso(0), null, iso(1800_000), now)).toBe(1800));
});

describe("computeUtilization", () => {
  it("talk / clocked, clamped, rounded", () => {
    expect(computeUtilization(3600, 900)).toBe(25);
    expect(computeUtilization(0, 0)).toBe(0);
    expect(computeUtilization(100, 200)).toBe(100); // clamp >100
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing).
```bash
pnpm --filter @lc/portal test tests/lib/shifts/lifecycle.test.ts
```

- [ ] **Step 3: Implement** `apps/portal/lib/shifts/lifecycle.ts`:
```ts
import { PRESENCE_STALE_AFTER_MS, SHIFT_CAP_EPSILON_MS, type ShiftEndedReason } from "@lc/shared";
import { isLiveShift } from "@/lib/voice/presence";

/** A non-manual close near the session cap is `capped`; otherwise `lapsed`. */
export function classifyShiftEnd(
  startedAtIso: string,
  endedAtIso: string,
  capMs: number,
): Extract<ShiftEndedReason, "lapsed" | "capped"> {
  const dur = Date.parse(endedAtIso) - Date.parse(startedAtIso);
  return dur >= capMs - SHIFT_CAP_EPSILON_MS ? "capped" : "lapsed";
}

/** The hard-gate predicate: on a live shift AND not on break. AWAY (heads-down
 *  remote work) is allowed; only BREAK and a lapsed/OFFLINE shift block work. */
export function canDoWork(status: string, lastSeenAt: string | null, nowMs: number): boolean {
  return isLiveShift(status, lastSeenAt, nowMs) && status !== "BREAK";
}

/** Clocked seconds for a shift. An open-but-stale shift uses its last heartbeat
 *  as the effective end so durations are accurate before the cron closes it. */
export function computeClockedSeconds(
  startedAtIso: string,
  endedAtIso: string | null,
  lastSeenAtIso: string | null,
  nowMs: number,
): number {
  const start = Date.parse(startedAtIso);
  let end: number;
  if (endedAtIso) {
    end = Date.parse(endedAtIso);
  } else {
    const lastSeen = lastSeenAtIso ? Date.parse(lastSeenAtIso) : null;
    const stale = lastSeen === null || nowMs - lastSeen > PRESENCE_STALE_AFTER_MS;
    end = stale && lastSeen !== null ? lastSeen : nowMs;
  }
  return Math.max(0, Math.round((end - start) / 1000));
}

/** Utilization % = talk-time / clocked, clamped 0..100, integer. */
export function computeUtilization(clockedSeconds: number, talkSeconds: number): number {
  if (clockedSeconds <= 0) return 0;
  return Math.min(100, Math.round((talkSeconds / clockedSeconds) * 100));
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**
```bash
git add apps/portal/lib/shifts/lifecycle.ts apps/portal/tests/lib/shifts/lifecycle.test.ts
git commit -m "feat(shifts): pure lifecycle helpers (classify/canDoWork/clocked/utilization)"
```

---

### Task 4: Shift store (`lib/shifts/store.ts`) — the DB side-effects

**Files:**
- Create: `apps/portal/lib/shifts/store.ts`
- Test: `apps/portal/tests/lib/shifts/store.test.ts`

These are the service-role open/close/break operations the four seams call. They take an admin client so they're testable with a mock.

- [ ] **Step 1: Write the failing tests**

Create `apps/portal/tests/lib/shifts/store.test.ts`. Model the mock on the existing admin-client mocks in `apps/portal/tests/` (a chainable object whose terminal `.maybeSingle()`/`.insert()`/`.update()` resolve to `{ data, error }`). Cover:
```ts
import { describe, it, expect, vi } from "vitest";
import { openShift, closeOpenShiftForUser, openBreak, closeOpenBreak } from "@/lib/shifts/store";

// Helper: build a chainable Supabase-like mock where each table returns a
// scripted result. Keep it minimal — assert the WRITES, not the query builder.
function mockAdmin(script: Record<string, unknown>) { /* ...build per existing test style... */ }

describe("openShift", () => {
  it("inserts a shift for the user+operator", async () => { /* assert insert called with {user_id, operator_id} */ });
  it("swallows a 23505 unique violation (already open)", async () => { /* insert returns {error:{code:'23505'}}; no throw */ });
});

describe("closeOpenShiftForUser", () => {
  it("no-ops when no open shift", async () => { /* maybeSingle -> {data:null}; no update */ });
  it("manual close sets ended_reason='manual' and closes open break", async () => { /* ... */ });
  it("auto close classifies capped/lapsed from duration", async () => { /* start 12h before endedAt -> 'capped' */ });
});

describe("openBreak / closeOpenBreak", () => {
  it("openBreak inserts a shift_breaks row for the open shift", async () => { /* ... */ });
  it("closeOpenBreak stamps ended_at on the open break", async () => { /* ... */ });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `apps/portal/lib/shifts/store.ts`:
```ts
import type { createAdminClient } from "@/lib/supabase/admin";
import { SESSION_MAX_MS } from "@lc/shared";
import { classifyShiftEnd } from "@/lib/shifts/lifecycle";

type Admin = ReturnType<typeof createAdminClient>;

/** Open a shift iff none is open. The partial unique index makes a race a 23505
 *  we deliberately swallow (a shift is already open — the desired end state). */
export async function openShift(admin: Admin, userId: string, operatorId: string): Promise<void> {
  const { error } = await admin
    .from("shifts")
    .insert({ user_id: userId, operator_id: operatorId });
  if (error && error.code !== "23505") {
    console.error("[shifts] openShift failed", error);
  }
}

/** Close the user's open shift (and any open break) at endedAtIso. `manual` =
 *  End shift; `auto` = lapse/cron (reason derived from duration). No-op if none open.
 *  The final UPDATE is guarded `.is("ended_at", null)` so the first writer wins. */
export async function closeOpenShiftForUser(
  admin: Admin,
  userId: string,
  endedAtIso: string,
  kind: "manual" | "auto",
): Promise<void> {
  const { data: open } = await admin
    .from("shifts")
    .select("id, started_at")
    .eq("user_id", userId)
    .is("ended_at", null)
    .maybeSingle();
  if (!open) return;

  await admin
    .from("shift_breaks")
    .update({ ended_at: endedAtIso })
    .eq("shift_id", open.id)
    .is("ended_at", null);

  const reason =
    kind === "manual" ? "manual" : classifyShiftEnd(open.started_at, endedAtIso, SESSION_MAX_MS);

  await admin
    .from("shifts")
    .update({ ended_at: endedAtIso, ended_reason: reason })
    .eq("id", open.id)
    .is("ended_at", null);
}

export async function openBreak(admin: Admin, userId: string): Promise<void> {
  const { data: open } = await admin
    .from("shifts")
    .select("id")
    .eq("user_id", userId)
    .is("ended_at", null)
    .maybeSingle();
  if (!open) return;
  const { error } = await admin.from("shift_breaks").insert({ shift_id: open.id });
  if (error && error.code !== "23505") console.error("[shifts] openBreak failed", error);
}

export async function closeOpenBreak(admin: Admin, userId: string, endedAtIso: string): Promise<void> {
  const { data: open } = await admin
    .from("shifts")
    .select("id")
    .eq("user_id", userId)
    .is("ended_at", null)
    .maybeSingle();
  if (!open) return;
  await admin
    .from("shift_breaks")
    .update({ ended_at: endedAtIso })
    .eq("shift_id", open.id)
    .is("ended_at", null);
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**
```bash
git add apps/portal/lib/shifts/store.ts apps/portal/tests/lib/shifts/store.test.ts
git commit -m "feat(shifts): service-role store (open/close/break) with first-writer-wins guards"
```

---

### Task 5: Open a shift on go-on-duty

**Files:**
- Modify: `apps/portal/app/api/presence/go-on-duty/route.ts`

- [ ] **Step 1: Wire it.** After the successful update (the `if (error)` block returns 500), before the 204:
```ts
import { openShift } from "@/lib/shifts/store";
// ...inside POST, replacing the tail after the error check:
  if (error) {
    return NextResponse.json({ error: "Could not go on duty" }, { status: 500 });
  }
  await openShift(admin, actor.userId, actor.operatorId);
  return new NextResponse(null, { status: 204 });
```

- [ ] **Step 2: Manual verification (local or staging).** Go on duty; confirm a `shifts` row with `ended_at IS NULL` exists for the user. Go on duty again; confirm no duplicate (the unique index holds).

- [ ] **Step 3: Commit**
```bash
git add apps/portal/app/api/presence/go-on-duty/route.ts
git commit -m "feat(shifts): open a shift row on go-on-duty"
```

---

### Task 6: Close the shift on end-shift

**Files:**
- Modify: `apps/portal/app/api/presence/end-shift/route.ts`

- [ ] **Step 1: Wire it.** After the successful OFFLINE update:
```ts
import { closeOpenShiftForUser } from "@/lib/shifts/store";
// ...after the error check, before the 204:
  await closeOpenShiftForUser(admin, actor.userId, new Date().toISOString(), "manual");
  return new NextResponse(null, { status: 204 });
```

- [ ] **Step 2: Manual verification.** Go on duty then End shift; confirm the row now has `ended_at` set and `ended_reason='manual'`.

- [ ] **Step 3: Commit**
```bash
git add apps/portal/app/api/presence/end-shift/route.ts
git commit -m "feat(shifts): close the shift row on end-shift (manual)"
```

---

### Task 7: Close the shift on heartbeat lapse

**Files:**
- Modify: `apps/portal/app/api/presence/route.ts`

The lapse-persist `UPDATE` (current lines 88–93) sets status OFFLINE but returns no rows. Add `.select("id, last_seen_at")`, and when it flipped a row, close that user's shift at `last_seen_at` (the frozen last beat).

- [ ] **Step 1: Modify the lapse block.** Replace the current `await admin.from("profiles").update({ status: "OFFLINE" })...lt("last_seen_at", staleCutoffIso);` with:
```ts
import { closeOpenShiftForUser } from "@/lib/shifts/store";
// ...the lapse branch:
  const { data: lapsed } = await admin
    .from("profiles")
    .update({ status: "OFFLINE" })
    .eq("id", actor.userId)
    .neq("status", "OFFLINE")
    .lt("last_seen_at", staleCutoffIso)
    .select("id, last_seen_at");

  if (lapsed && lapsed.length > 0) {
    await closeOpenShiftForUser(
      admin,
      actor.userId,
      lapsed[0].last_seen_at ?? staleCutoffIso,
      "auto",
    );
  }

  return NextResponse.json({ onDuty: false });
```

- [ ] **Step 2: Run the presence-related tests.**
```bash
pnpm --filter @lc/portal test presence
```
Expected: existing tests still pass (the added `.select` + close is additive).

- [ ] **Step 3: Commit**
```bash
git add apps/portal/app/api/presence/route.ts
git commit -m "feat(shifts): close a lapsed shift from the heartbeat at last_seen_at"
```

---

### Task 8: Close shifts on the cron sweep (bulk backstop)

**Files:**
- Modify: `apps/portal/app/api/cron/mark-stale-offline/route.ts`

- [ ] **Step 1: Return the swept rows and close each shift.** Replace the bulk `update(...).neq("status","OFFLINE");` (lines 20–24) with a `.select`, then close each:
```ts
import { closeOpenShiftForUser } from "@/lib/shifts/store";
// ...
  const { data: swept } = await admin
    .from("profiles")
    .update({ status: "OFFLINE" })
    .lt("last_seen_at", cutoff)
    .neq("status", "OFFLINE")
    .select("id, last_seen_at");

  await Promise.all(
    (swept ?? []).map((p) =>
      closeOpenShiftForUser(admin, p.id, p.last_seen_at ?? cutoff, "auto"),
    ),
  );
```
Leave the operator heartbeat self-report (lines 26–30) unchanged.

- [ ] **Step 2: Manual verification.** With a shift open, hand-set the profile's `last_seen_at` to 2 minutes ago (SQL), hit the cron with the `CRON_SECRET`, confirm the shift closed with `ended_reason='lapsed'` and `ended_at` = the frozen `last_seen_at`.

- [ ] **Step 3: Commit**
```bash
git add apps/portal/app/api/cron/mark-stale-offline/route.ts
git commit -m "feat(shifts): cron sweep closes lapsed shifts at last_seen_at (backstop)"
```

---

## Phase B — BREAK status + break routes + hard gate

*Ships: an agent can go on break (tracked), and work is server-gated behind a live, non-break shift.*

### Task 9: Add BREAK to the presence predicates

**Files:**
- Modify: `apps/portal/lib/voice/presence.ts`
- Modify: `apps/portal/lib/push/targets.ts`
- Test: `apps/portal/tests/lib/voice/presence.test.ts` (add cases)

- [ ] **Step 1: Add the failing test cases** to `presence.test.ts`:
```ts
import { isLiveStatus, isLiveShift, isReachableForDial } from "@/lib/voice/presence";
import { isVideoSilencedStatus } from "@/lib/push/targets";

const now = 1_000_000_000_000;
const fresh = new Date(now - 5_000).toISOString();

it("BREAK is a browser-settable live status", () => expect(isLiveStatus("BREAK")).toBe(true));
it("BREAK keeps the shift live", () => expect(isLiveShift("BREAK", fresh, now)).toBe(true));
it("BREAK is not dialed", () => expect(isReachableForDial("BREAK", fresh, now)).toBe(false));
it("BREAK silences video", () => expect(isVideoSilencedStatus("BREAK")).toBe(true));
```

- [ ] **Step 2: Run — expect FAIL** (`isLiveStatus("BREAK")` false; `isVideoSilencedStatus("BREAK")` false).

- [ ] **Step 3: Edit `presence.ts`:**
  - Line 3 union: `export type PresenceStatus = "AVAILABLE" | "ON_CALL" | "AWAY" | "BREAK" | "OFFLINE";`
  - `LIVE_STATUSES` set (lines 5–9): add `"BREAK"`.
  - `isReachableForDial` (line 66): unchanged — it returns true only for AVAILABLE/ON_CALL, so BREAK is already excluded.
  - `isLiveShift` (line 41): unchanged — BREAK is non-OFFLINE, so a BREAK shift stays live (correct; break keeps the shift open).

  Edit `lib/push/targets.ts` `isVideoSilencedStatus` (line 20):
```ts
  return status === "OFFLINE" || status === "AWAY" || status === "BREAK";
```

- [ ] **Step 4: Run — expect PASS.** Run the full presence + push test files.

- [ ] **Step 5: Commit**
```bash
git add apps/portal/lib/voice/presence.ts apps/portal/lib/push/targets.ts apps/portal/tests/lib/voice/presence.test.ts
git commit -m "feat(shifts): BREAK status in predicates (live, undialed, video-silenced)"
```

---

### Task 10: Take-break + resume routes; presence GET returns shift context

**Files:**
- Create: `apps/portal/app/api/presence/take-break/route.ts`
- Create: `apps/portal/app/api/presence/resume/route.ts`
- Modify: `apps/portal/app/api/presence/route.ts` (GET)

- [ ] **Step 1: take-break route.** Model on `end-shift/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor } from "@/lib/auth/api-actor";
import { openBreak } from "@/lib/shifts/store";

export const runtime = "nodejs";

/** Take a break (spec D6): BREAK = on duty, not working. Service-role (0012 guard). */
export async function POST(): Promise<NextResponse> {
  const actorOrResponse = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actorOrResponse instanceof NextResponse) return actorOrResponse;
  const actor = actorOrResponse;

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ status: "BREAK", last_seen_at: new Date().toISOString() })
    .eq("id", actor.userId);
  if (error) return NextResponse.json({ error: "Could not start break" }, { status: 500 });

  await openBreak(admin, actor.userId);
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 2: resume route.** Same shape, sets `AVAILABLE` + `closeOpenBreak`:
```ts
import { closeOpenBreak } from "@/lib/shifts/store";
// ...
  const { error } = await admin
    .from("profiles")
    .update({ status: "AVAILABLE", last_seen_at: new Date().toISOString() })
    .eq("id", actor.userId);
  if (error) return NextResponse.json({ error: "Could not resume" }, { status: 500 });
  await closeOpenBreak(admin, actor.userId, new Date().toISOString());
  return new NextResponse(null, { status: 204 });
```

- [ ] **Step 3: Extend GET `/api/presence`** to return break + shift start for the header. Replace the GET body's read + return with:
```ts
  const { data, error } = await admin
    .from("profiles")
    .select("status, last_seen_at")
    .eq("id", actor.userId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "Could not read duty state" }, { status: 500 });
  }
  const status = data?.status ?? "OFFLINE";
  const onDuty = isLiveShift(status, data?.last_seen_at ?? null, Date.now());

  let shiftStartedAt: string | null = null;
  if (onDuty) {
    const { data: open } = await admin
      .from("shifts")
      .select("started_at")
      .eq("user_id", actor.userId)
      .is("ended_at", null)
      .maybeSingle();
    shiftStartedAt = open?.started_at ?? null;
  }

  return NextResponse.json({
    onDuty,
    accepting: status !== "AWAY",
    onBreak: status === "BREAK",
    shiftStartedAt,
  });
```

- [ ] **Step 4: Manual verification.** POST take-break → `profiles.status='BREAK'` + a `shift_breaks` row open. POST resume → `AVAILABLE` + break closed. GET `/api/presence` returns `onBreak` + `shiftStartedAt`.

- [ ] **Step 5: Commit**
```bash
git add apps/portal/app/api/presence/take-break/route.ts apps/portal/app/api/presence/resume/route.ts apps/portal/app/api/presence/route.ts
git commit -m "feat(shifts): take-break/resume routes + presence GET returns break + shift start"
```

---

### Task 11: Reusable server-side duty gate (`requireOnDuty`)

**Files:**
- Create: `apps/portal/lib/shifts/gate.ts`
- Test: `apps/portal/tests/lib/shifts/gate.test.ts`

The actor carries only `userId/operatorId/role` (no status), so the gate does a fresh `profiles` read. Fail-CLOSED on a read error (a work action must not proceed if we can't confirm duty).

- [ ] **Step 1: Write the failing test** (mock admin client returning status rows):
```ts
import { describe, it, expect } from "vitest";
import { NextResponse } from "next/server";
import { requireOnDuty } from "@/lib/shifts/gate";
// mockAdmin returns { data:{status,last_seen_at}, error } for profiles.select().eq().maybeSingle()
it("passes when AVAILABLE + fresh", async () => { /* expect result === null (no block) */ });
it("403s when OFFLINE", async () => { /* expect NextResponse w/ status 403 */ });
it("403s when BREAK", async () => { /* 403 */ });
it("403s (fail closed) on a read error", async () => { /* error set -> 403 */ });
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `apps/portal/lib/shifts/gate.ts`:
```ts
import { NextResponse } from "next/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { canDoWork } from "@/lib/shifts/lifecycle";

type Admin = ReturnType<typeof createAdminClient>;

/** Server-side hard gate: returns null if the user may work, else a 403 the
 *  caller returns. Fail-CLOSED (a work action must not run if duty is unconfirmable). */
export async function requireOnDuty(admin: Admin, userId: string): Promise<NextResponse | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("status, last_seen_at")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json({ error: "Go on duty to start your shift" }, { status: 403 });
  }
  if (!canDoWork(data.status, data.last_seen_at, Date.now())) {
    return NextResponse.json({ error: "Go on duty to start your shift" }, { status: 403 });
  }
  return null;
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**
```bash
git add apps/portal/lib/shifts/gate.ts apps/portal/tests/lib/shifts/gate.test.ts
git commit -m "feat(shifts): requireOnDuty server-side hard-gate helper (fail-closed)"
```

---

### Task 12: Gate RustDesk Connect + keep-alive

**Files:**
- Modify: `apps/portal/app/api/remote-access/[propertyId]/route.ts`

- [ ] **Step 1: Insert the gate + keep-alive.** After the actor guard (line 15), create the admin client early, gate, and refresh the heartbeat (Connect = keep-alive, per spec §7.2):
```ts
import { requireOnDuty } from "@/lib/shifts/gate";
// ...inside GET, after `if (actor instanceof NextResponse) return actor;`
  const admin = createAdminClient();
  const gate = await requireOnDuty(admin, actor.userId);
  if (gate) return gate;
  // Connect acts as a heartbeat so a long remote session doesn't lapse the shift.
  await admin
    .from("profiles")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", actor.userId)
    .neq("status", "OFFLINE");

  const { propertyId } = await params;
  // ...rest unchanged, reusing the `admin` created above (remove the later `const admin = createAdminClient()`)
```
Note: the route already creates `admin` at its old line 20 — hoist that single declaration up so there's exactly one.

- [ ] **Step 2: Manual verification (staging).** Off duty → Connect returns 403, no credentials, no `credentials_issued` audit row. On duty → 200 + credentials + audit. On duty, Connect twice a minute apart → `last_seen_at` advances (keep-alive).

- [ ] **Step 3: Commit**
```bash
git add "apps/portal/app/api/remote-access/[propertyId]/route.ts"
git commit -m "feat(shifts): hard-gate RustDesk Connect on a live shift + keep-alive"
```

---

### Task 13: Gate answer-video

**Files:**
- Modify: `apps/portal/app/api/calls/[id]/answer-video/route.ts`

- [ ] **Step 1: Insert the gate** between the actor guard (line 19) and `fetchOperatorCall` (line 21):
```ts
import { requireOnDuty } from "@/lib/shifts/gate";
// ...after `if (actor instanceof NextResponse) return actor;`
  const admin = createAdminClient();
  const gate = await requireOnDuty(admin, actor.userId);
  if (gate) return gate;
```
The route already creates `admin` at its old line 34 — hoist to the single declaration above and delete the later one.

- [ ] **Step 2: Run** `pnpm --filter @lc/portal test answer-video` (if a test exists) plus typecheck.

- [ ] **Step 3: Commit**
```bash
git add "apps/portal/app/api/calls/[id]/answer-video/route.ts"
git commit -m "feat(shifts): hard-gate answer-video on a live shift"
```

---

## Phase C — Duty control moves to the header (DutyProvider)

*Ships: the constant-size duty control lives in the header (both roles), the softphone no longer renders duty buttons, break/resume + on-duty timer work, and Connect/video show a gated state off-duty. This is the highest-risk phase — the softphone's duty tests are the safety net; keep them green at every step.*

> **Read before starting:** `apps/portal/components/dashboard/duty-controls.tsx`, the softphone duty internals (`onDuty` state ~113, hydration ~516, heartbeat ~503, `endShift`/`resumeDuty` ~737, `<DutyControls>` render ~802), `apps/portal/components/dashboard/dashboard-header.tsx` (children slot), `apps/portal/components/dashboard-workspace.tsx`, and `apps/portal/components/app-shell.tsx`. The duty control currently arms Web Push + primes the softphone ring element *inside the go-on-duty gesture* — that must be preserved.

### Task 14: DutyProvider context

**Files:**
- Create: `apps/portal/components/dashboard/duty-provider.tsx`
- Test: `apps/portal/tests/components/duty-provider.test.tsx`

Owns duty state + handlers; hydrates from GET `/api/presence`; exposes a `registerPrime` seam (mirrors `CallSurfaceProvider.registerAcceptAudio`) so the softphone's real ring element is primed on go-on-duty without lifting the `<audio>` out.

- [ ] **Step 1: Write the failing test.** Cover: hydration sets `onDuty`/`onBreak`/`shiftStartedAt` from a mocked `/api/presence`; `goOnDuty()` calls the registered prime fn + POSTs `/api/presence/go-on-duty`; `takeBreak()`/`resume()` POST their routes and flip `onBreak`; `canWork` is `onDuty && !onBreak`. Model fetch mocks on `softphone.test.tsx`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `duty-provider.tsx`. Shape:
```tsx
"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { armPush } from "@/lib/push/client";

type DutyState = {
  onDuty: boolean;
  onBreak: boolean;
  shiftStartedAt: string | null;
  accepting: boolean;
  canWork: boolean;
  goOnDuty: () => Promise<void>;
  endShift: () => Promise<void>;
  takeBreak: () => Promise<void>;
  resume: () => Promise<void>;
  registerPrime: (fn: (() => void) | null) => void;
  registerBeat: (fn: (() => void) | null) => void; // softphone registers its beat()
  pushBlocked: boolean;
};

const Ctx = createContext<DutyState | null>(null);
export function useDuty(): DutyState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDuty must be used within DutyProvider");
  return v;
}
export function useDutyOptional(): DutyState | null {
  return useContext(Ctx);
}

export function DutyProvider({ children }: { readonly children: React.ReactNode }) {
  const [onDuty, setOnDuty] = useState(true);      // fail-open default; hydration corrects
  const [onBreak, setOnBreak] = useState(false);
  const [shiftStartedAt, setShiftStartedAt] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(true);
  const [pushBlocked, setPushBlocked] = useState(false);
  const primeRef = useRef<(() => void) | null>(null);
  const beatRef = useRef<(() => void) | null>(null);

  const registerPrime = useCallback((fn: (() => void) | null) => { primeRef.current = fn; }, []);
  const registerBeat = useCallback((fn: (() => void) | null) => { beatRef.current = fn; }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/presence");
        if (res.ok) {
          const b = (await res.json().catch(() => null)) as
            | { onDuty?: boolean; onBreak?: boolean; accepting?: boolean; shiftStartedAt?: string | null }
            | null;
          if (b && !cancelled) {
            if (typeof b.onDuty === "boolean") setOnDuty(b.onDuty);
            if (typeof b.onBreak === "boolean") setOnBreak(b.onBreak);
            if (typeof b.accepting === "boolean") setAccepting(b.accepting);
            setShiftStartedAt(b.shiftStartedAt ?? null);
          }
        }
      } catch { /* fail-open */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const goOnDuty = useCallback(async () => {
    primeRef.current?.();               // unlock ring autoplay (softphone element)
    const ok = await armPush();         // permission prompt INSIDE this gesture
    setPushBlocked(!ok);
    setOnDuty(true); setOnBreak(false);
    await fetch("/api/presence/go-on-duty", { method: "POST" }).catch(() => {});
    // refetch shiftStartedAt (a new shift just opened)
    try {
      const res = await fetch("/api/presence");
      const b = res.ok ? await res.json().catch(() => null) : null;
      if (b) setShiftStartedAt(b.shiftStartedAt ?? null);
    } catch { /* ignore */ }
    beatRef.current?.();
  }, []);

  const endShift = useCallback(async () => {
    setOnDuty(false); setOnBreak(false); setShiftStartedAt(null);
    await fetch("/api/presence/end-shift", { method: "POST" }).catch(() => {});
  }, []);

  const takeBreak = useCallback(async () => {
    setOnBreak(true);
    await fetch("/api/presence/take-break", { method: "POST" }).catch(() => {});
  }, []);

  const resume = useCallback(async () => {
    setOnBreak(false);
    await fetch("/api/presence/resume", { method: "POST" }).catch(() => {});
    beatRef.current?.();
  }, []);

  const canWork = onDuty && !onBreak;

  return (
    <Ctx.Provider value={{ onDuty, onBreak, shiftStartedAt, accepting, canWork,
      goOnDuty, endShift, takeBreak, resume, registerPrime, registerBeat, pushBlocked }}>
      {children}
    </Ctx.Provider>
  );
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**
```bash
git add apps/portal/components/dashboard/duty-provider.tsx apps/portal/tests/components/duty-provider.test.tsx
git commit -m "feat(shifts): DutyProvider context (duty state, break, prime/beat seams)"
```

---

### Task 15: Header duty control component

**Files:**
- Create: `apps/portal/components/dashboard/duty-control.tsx`
- Test: `apps/portal/tests/components/duty-control.test.tsx`

Constant-size control (fixed footprint across states — spec §8.1). Reads `useDuty()`. States: off → "Go on duty"; on → live pill with running timer + "Take a break" + a menu (End shift); break → "On break" + "Resume" + menu; on-call handling can reuse the on state (the call timer lives in the tile/overlay, so the pill can just show "On duty" during a call in v1 — keep it simple, and hide "Take a break" when a call is active via a prop from the softphone if needed; otherwise allow break only when idle).

- [ ] **Step 1: Write the failing test** — renders "Go on duty" when off; renders the elapsed timer + "Take a break" when on; renders "Resume" when on break; clicking calls the right `useDuty()` handler (wrap in a mock provider).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** the component. Fixed footprint via a wrapper `className="flex w-[20rem] items-center justify-end"` and each variant `w-full`. Use brand tokens (mint `bg-live`, blaze `bg-attention`/`text-attention` for break, navy header context). Timer: a `setInterval` computing `Date.now() - Date.parse(shiftStartedAt)` formatted `Hh Mm`. Menu: a shadcn `DropdownMenu` (see `components/account-menu.tsx` for the pattern) with "End shift". Respect `prefers-reduced-motion` on any pulse. Reuse the mockup's copy: "Go on duty", "On duty", "Take a break", "On break", "Resume", "End shift".

- [ ] **Step 4: Run — expect PASS.** Also add a test asserting the wrapper keeps a constant width class across states (the fixed-footprint requirement).

- [ ] **Step 5: Commit**
```bash
git add apps/portal/components/dashboard/duty-control.tsx apps/portal/tests/components/duty-control.test.tsx
git commit -m "feat(shifts): constant-size header duty control (off/on/break)"
```

---

### Task 16: Wire the provider + header slot; strip duty from the softphone

**Files:**
- Modify: `apps/portal/components/app-shell.tsx` (mount `DutyProvider`)
- Modify: `apps/portal/components/dashboard-workspace.tsx` (render `DutyControl` in the header)
- Modify: `apps/portal/components/softphone/softphone.tsx` (remove `<DutyControls>`; read duty from `useDuty()`; register prime + beat)
- Delete: `apps/portal/components/dashboard/duty-controls.tsx` (its job moves to `DutyControl`)
- Modify: `apps/portal/tests/components/softphone.test.tsx` (wrap in `DutyProvider`; the duty assertions move to duty-control/duty-provider tests)

This is the delicate step. Do it in small commits and keep `pnpm --filter @lc/portal test softphone` green.

- [ ] **Step 1: Mount `DutyProvider`** in `app-shell.tsx`, wrapping `SidebarProvider` (inside `CallSurfaceProvider`):
```tsx
import { DutyProvider } from "@/components/dashboard/duty-provider";
// ...
    <LineStatusProvider>
      <CallSurfaceProvider>
        <DutyProvider>
          <SidebarProvider defaultOpen={false}>
          ...
          </SidebarProvider>
        </DutyProvider>
      </CallSurfaceProvider>
    </LineStatusProvider>
```

- [ ] **Step 2: Render `DutyControl` in the header** (`dashboard-workspace.tsx`), alongside the account menu:
```tsx
import { DutyControl } from "@/components/dashboard/duty-control";
// ...
      <DashboardHeader firstName={firstName}>
        <div className="flex items-center gap-3">
          <DutyControl />
          <AccountMenu fullName={fullName} email={email} role={role} />
        </div>
      </DashboardHeader>
```

- [ ] **Step 3: Softphone — consume the provider instead of local duty state.** In `softphone.tsx`:
  - Replace the local `onDuty`/`onDutyRef`/hydration-effect/`endShift`/`resumeDuty` ownership with `const { onDuty, canWork, registerPrime, registerBeat } = useDuty();` (import `useDutyOptional` and no-op if null, so the softphone still renders on pages without the provider / in isolated tests). Keep `onDutyRef` as a mirror of the provider `onDuty` for the heartbeat gate.
  - Register the ring-prime + beat with the provider on mount: `useEffect(() => { registerPrime(primeRing); registerBeat(() => void beatRef.current()); return () => { registerPrime(null); registerBeat(null); }; }, [registerPrime, registerBeat]);`
  - Remove the `<DutyControls .../>` JSX block (lines ~796–813) entirely.
  - Keep the heartbeat loop, `beat`, `resyncDuty`, the AWAY "Accepting calls" toggle, and the ring element unchanged — only the duty *ownership* moves.
  - The GET `/api/presence` hydration is now owned by the provider; delete the softphone's own hydration effect to avoid a double read (the provider hydrates; the softphone reads `onDuty` from it).

- [ ] **Step 4: Delete `duty-controls.tsx`** and update `softphone.test.tsx` to wrap the rendered softphone in `<DutyProvider>` (and move any duty-button assertions to the new tests). Run:
```bash
pnpm --filter @lc/portal test softphone duty-provider duty-control
```
Expected: all green. Fix any prop/ref mismatches.

- [ ] **Step 5: Full suite + typecheck + lint.**
```bash
pnpm --filter @lc/portal test && pnpm --filter @lc/portal typecheck && pnpm lint
```

- [ ] **Step 6: Manual verification (staging).** Both agent + admin: the duty control shows in the header at a constant size; Go on duty arms push + opens a shift; the softphone shows no duty buttons; End shift closes the shift; the timer ticks.

- [ ] **Step 7: Commit**
```bash
git add -A
git commit -m "feat(shifts): move duty control to the header via DutyProvider; strip from softphone"
```

---

### Task 17: Gate ConnectButton + video host in the UI

**Files:**
- Modify: `apps/portal/components/dashboard/connect-button.tsx`
- Modify: `apps/portal/components/video-call/video-call-host.tsx` (or wherever the incoming Answer renders)

- [ ] **Step 1: ConnectButton.** Read `useDutyOptional()`; when `canWork` is false, render the button disabled with a "Go on duty to start" tooltip/label instead of firing Connect. The server 403 (Task 12) remains the real lock; this is UX. Keep it a no-op when the provider is absent (owner surfaces, tests).

- [ ] **Step 2: Video host.** When `!canWork`, render the incoming banner's Answer in a disabled/"go on duty" state (defense-in-depth; the poll already hides calls from OFFLINE/AWAY/BREAK, so this mainly covers the stale-but-unswept edge).

- [ ] **Step 3: Run the relevant component tests + typecheck.**

- [ ] **Step 4: Commit**
```bash
git add -A
git commit -m "feat(shifts): UI-gate Connect + video Answer on canWork (server 403 is the real lock)"
```

---

## Phase D — Admin timesheet page

*Ships: `/admin/shifts` between Audit log and Status, clocked-vs-worked per shift, with editing.*

### Task 18: Timesheet query + metrics (`lib/shifts/query.ts`)

**Files:**
- Create: `apps/portal/lib/shifts/query.ts`
- Test: `apps/portal/tests/lib/shifts/query.test.ts`

- [ ] **Step 1: Write failing tests** for the pure metric-assembly function `assembleShiftRow(shift, calls, remoteCount, profile, nowMs)` → `{ userId, name, role, startedAt, endedAt, endedReason, clockedSeconds, callCount, talkSeconds, remoteCount, utilization }`. Cover: a closed shift, an open-stale shift (effective end via `computeClockedSeconds`), utilization via `computeUtilization`. Also test `parseTimesheetRange(searchParams)` → `{ fromIso, toIso, label }` defaulting to the last 7 days.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `query.ts`:
  - `parseTimesheetRange(sp)` — default `from` = 7 days ago (start of day), `to` = now; accept `?from`/`?to` overrides.
  - `assembleShiftRow(...)` — pure, uses `computeClockedSeconds` + `computeUtilization` from `lifecycle.ts`.
  - `fetchTimesheet(supabase, admin, operatorId, range)` — the impure orchestrator: select `shifts` for the operator in range (RLS admin-scoped via `supabase`), then for the involved `user_id`s batch-fetch profiles (name/role) + `last_seen_at`, batch-fetch `calls` (`handled_by_user_id in (...)`, `answered_at` in range, `state='COMPLETED'` or the completed set, `channel`, `duration_seconds`), and `audit_logs` (`actor_user_id in (...)`, `action='remote_access.credentials_issued'`, `created_at` in range) counted per user/shift-window. Assemble rows client-side (the 2-query actor-merge pattern from `admin/audit/page.tsx`). Attribute a call/remote-connect to a shift when its timestamp falls in `[started_at, effectiveEnd)`.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**
```bash
git add apps/portal/lib/shifts/query.ts apps/portal/tests/lib/shifts/query.test.ts
git commit -m "feat(shifts): timesheet query + metric assembly (clocked vs worked)"
```

---

### Task 19: `/admin/shifts` page + table + nav

**Files:**
- Create: `apps/portal/app/(admin)/admin/shifts/page.tsx`
- Create: `apps/portal/app/(admin)/admin/shifts/shifts-table.tsx`
- Modify: `apps/portal/components/app-sidebar.tsx` (nav entry)

- [ ] **Step 1: Nav entry.** In `app-sidebar.tsx`, add to `ADMIN_NAV` **between** `audit` and `status`:
```tsx
import { Clock } from "lucide-react"; // add to the existing lucide import
// ...
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/shifts", label: "Shifts", icon: Clock },
  { href: "/admin/status", label: "Status", icon: Activity },
```

- [ ] **Step 2: Page** — Server Component, model on `admin/audit/page.tsx`:
```tsx
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseTimesheetRange, fetchTimesheet } from "@/lib/shifts/query";
import { ShiftsTable } from "./shifts-table";

export default async function AdminShiftsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const actor = await requireRole("ADMIN");
  const range = parseTimesheetRange(sp);
  const supabase = await createServerClient();
  const admin = createAdminClient();
  const rows = await fetchTimesheet(supabase, admin, actor.operator_id, range);
  return (
    <div className="flex w-full max-w-6xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold text-foreground">Shifts</h1>
      <ShiftsTable rows={rows} range={range} />
    </div>
  );
}
```
Note `fetchTimesheet` reads `shifts` via the RLS-scoped `supabase` (admin policy) and the `calls`/`audit_logs`/`profiles`/`last_seen_at` context via `admin` (service-role) — mirror how `audit/page.tsx` uses `supabase` for the scoped read and a separate read for the profile merge.

- [ ] **Step 3: Table** — `"use client"`, model on `audit-table.tsx`. Columns: Agent (avatar+name+role), Shift (start–end, `tabular-nums`), Clocked, Calls, Talk, Remote, Utilization (a bar like the mockup), Ended (a `Badge` chip: `manual`→"Ended shift", `lapsed`→"Tab closed", `capped`→"Capped 12h", null→"On shift"). A summary strip (clocked / actual work / fleet utilization / shifts capped) above the table. A period control (This week / Last week / range) that pushes `?from&to`. Row actions (edit end time, delete, add) wire to Task 20's actions via a dialog — start with **read-only display in this task**, add the edit dialog in Task 20.

- [ ] **Step 4: Verify** typecheck + `check:routes` (the new literal href resolves) + render locally/staging.
```bash
pnpm --filter @lc/portal typecheck && pnpm check:routes
```

- [ ] **Step 5: Commit**
```bash
git add "apps/portal/app/(admin)/admin/shifts" apps/portal/components/app-sidebar.tsx
git commit -m "feat(shifts): /admin/shifts timesheet page + nav between audit and status"
```

---

### Task 20: Admin shift edit/delete/add (audited)

**Files:**
- Create: `apps/portal/app/(admin)/admin/shifts/actions.ts`
- Create: `apps/portal/lib/shifts/validate.ts` (+ test)
- Modify: `apps/portal/lib/audit/actions.ts` (new actions)
- Modify: `apps/portal/app/(admin)/admin/shifts/shifts-table.tsx` (edit dialog)

- [ ] **Step 1: Audit actions.** In `lib/audit/actions.ts`, add to `AUDIT_ACTIONS`:
```ts
  SHIFT_EDITED: "shift.edited",
  SHIFT_DELETED: "shift.deleted",
  SHIFT_CREATED_MANUAL: "shift.created_manual",
```

- [ ] **Step 2: Validation helpers (TDD).** `lib/shifts/validate.ts`: `validateShiftTimes(startedAtIso, endedAtIso | null)` → error string | null (end after start; not in the future beyond a small skew; both parseable). Test the boundaries.

- [ ] **Step 3: Server actions** (`actions.ts`), model on `admin/users/actions.ts` (requireRole → validate → write via `createAdminClient` → `logAuditEvent` → `revalidatePath`):
  - `editShiftAction({ id, started_at, ended_at })` — validate, update (scoped to the actor's operator; stamp `edited_by=actor.id`, `edited_at=now`), audit `SHIFT_EDITED`, `revalidatePath("/admin/shifts")`.
  - `deleteShiftAction({ id })` — audit `SHIFT_DELETED` (write the audit row before delete, per the hard-delete convention), delete, revalidate.
  - `addShiftAction({ user_id, started_at, ended_at })` — validate, insert with `operator_id=actor.operator_id`, `ended_reason='manual'`, `edited_by=actor.id`, audit `SHIFT_CREATED_MANUAL`, revalidate.

  Use the RLS admin policies from Task 1 (so a user-scoped client would also work), but follow the codebase norm: these run under `requireRole("ADMIN")` and may use `createAdminClient()` for the write with an explicit `operator_id`/id scope, matching `admin/users/actions.ts`.

- [ ] **Step 4: Edit dialog** in `shifts-table.tsx` — an AlertDialog/Dialog per row (edit end time; delete with typed confirm per the hard-delete convention) and an "Add shift" dialog. Wire to the actions.

- [ ] **Step 5: Run** the validate test + full suite + typecheck + lint.

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat(shifts): admin edit/delete/add shift actions (audited) + edit dialog"
```

---

## Phase E — Ops: cron cadence + session cap

*Ships: shifts close promptly and the 12h cap is live. Mostly config; one code change.*

### Task 21: Deploy-time ops (cron cadence + session time-box) — NO code change

**DECISION (2026-07-12, during execution): do NOT change `CRON_SWEEP_INTERVAL_MS`.** Investigation found it is used in exactly two places — `lib/status/signals.ts` (the `/admin/status` warn/down thresholds) and `protocol.test.ts` — and the presence cron's *behavior* uses `PRESENCE_STALE_AFTER_MS` (90s), NOT this constant. So the constant purely tunes `/status` observability. Tightening it to 15 min would break the box's `/status` unless the Coolify cron changes in the same breath, would make the **frozen Vercel standby's** `/status` show the presence cron degraded (its `vercel.json` cron stays daily, and Vercel Hobby cannot even schedule `*/15` — it errors the deploy), and needs test churn — all to buy marginally-tighter observability. The actual goal (shifts close promptly) is met by the **ops cron-cadence change alone**: with the Coolify presence cron at `*/15`, lapsed/capped shifts close within 15 min, and `/status` stays green under the lenient 24h-derived thresholds. `computeClockedSeconds` already gives accurate durations for still-open-stale shifts at read time, so the cron cadence only affects how fast a row's badge flips from "On shift" to a closed reason.

There is therefore **no code to write or commit for Task 21** — it is three deploy-time ops steps, coordinated with the migration + env exactly like the 2026-07-09 cutover (0019/0020 applied via MCP). Do these when the branch merges to `main` (which Coolify auto-deploys to the box):

- [ ] **Deploy step A — apply migration `0021` to prod Supabase** via the Supabase MCP (same flow as 0018→0020 at cutover). Prod goes from 0020 → 0021 (shifts + shift_breaks tables, BREAK status, RLS).
- [ ] **Deploy step B — set the Coolify `lc-ops` presence cron** (`/api/cron/mark-stale-offline`) to `*/15 * * * *` (the reaper is already `*/15`). This closes lapsed/capped shifts within 15 min. No code change needed; `/status` thresholds stay lenient and green. Record in `docs/setup/2026-07-02-box-ops-runbook.md`.
- [ ] **Deploy step C — set the 12h session time-box** in Supabase Dashboard → Auth → Sessions → "Time-box user sessions" = 12h (43200s) on **prod**. This is what auto-signs-out (and thereby auto-clocks-out) a forgotten-open browser at the 12h cap. Record in `docs/setup/2026-07-03-accounts-credentials-inventory.md` + the runbook. Verify a >12h session is rejected on its next request.

**Deferred (optional, later):** if tighter presence-cron observability is wanted, `CRON_SWEEP_INTERVAL_MS` can be lowered — but only once the frozen Vercel standby is decommissioned (so its Hobby-capped daily `vercel.json` cron no longer clashes with a sub-daily threshold). Not worth doing while the standby lives.

---

## Self-review notes (author)

- **Spec coverage:** D1 admin-only (Phase D, no owner view) ✓; D2 editable presence-derived shifts (Tasks 1,4–8,20) ✓; D3 actual-work metrics (Task 18) ✓; D4 server gate (Tasks 11–13) ✓; D5 header control constant-size (Tasks 15–16) ✓; D6 BREAK (Tasks 1,9,10,14,15) ✓; D7 12h cap (Tasks 2,21) ✓; D8 ended_reason (Tasks 1,4) ✓; D9 ended_at=last heartbeat (Tasks 4,7,8) ✓; §7.2 keep-alive (Task 12) ✓; §10 cron cadence (Task 21) ✓.
- **Known residual (spec §7.2):** long remote session + throttled heartbeat can still lapse → 403. Mitigated by the Task-12 keep-alive; the deeper heartbeat hardening stays tracked as `task_71d65b0a` and is out of scope here. Flag at smoke.
- **AWAY vs BREAK:** the existing "Accepting calls" AWAY toggle stays in the softphone; BREAK is separate and hard-gated. `canDoWork` blocks only BREAK/OFFLINE, so AWAY (heads-down remote work) still passes the Connect gate — intentional.
- **Highest risk:** Task 16 (duty ownership moves out of the softphone). Keep `softphone.test.tsx` green at every step; commit small.
```
