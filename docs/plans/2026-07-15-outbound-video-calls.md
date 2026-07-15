# Outbound Video Calls (+ kiosk liveness) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent start a video call *to* a property's lobby kiosk (call-back flow), reusing the existing kiosk⇄agent LiveKit stack with the originator reversed; fold in kiosk liveness and fix the tracked presence-reset bug (`task_71d65b0a`).

**Architecture:** Reuse-and-reverse. The agent originates (new `start-outbound-video` route → creates an `OUTBOUND`/`RINGING` VIDEO `calls` row, sets agent `ON_CALL`, mounts the existing `video-call.tsx` surface in a new `"calling"` phase). The kiosk discovers the call via a 3s poll (`kiosk/incoming-call`), taps **Answer** (`kiosk/answer-call` → `RINGING → IN_PROGRESS`), joins the same LiveKit room, and both land in the byte-identical connected surface (captions/chat/RustDesk unchanged). Concurrency is handled by the existing one-active-call index (0016). Everything additive and blue-green-safe.

**Tech Stack:** Next.js App Router (portal) + Vite/React 19 (kiosk); LiveKit; Supabase (Postgres + RLS + service-role admin client); Vitest (node + jsdom); TypeScript; Tailwind v4. Shared constants in `@lc/shared` (`packages/shared/src/`).

**Spec:** `docs/specs/2026-07-15-outbound-video-calls-design.md` (canonical; decision log D1–D11).

**Conventions for this plan:**
- Commits follow repo convention: conventional message, no emojis, end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.
- TDD the pure logic (Vitest). Routes and LiveKit reverse-connect are **smoke-only** on staging + the real iPad ("don't judge video on a Mac").
- After a task, the tree stays green: `pnpm lint && pnpm typecheck && pnpm test && pnpm check:routes` (root). Everything here is additive/guarded so each task leaves `main`-mergeable state.
- Branch: `outbound-video-calls` (already checked out; spec committed at `a8e30a4`).
- **Do NOT `git add -A`** — `analysis-and-audit-2026_07_11/` is deliberately untracked (prior key-leak). Add files explicitly by path.

**Design refinements locked during codebase mapping (deviations from the spec's first draft, all intentional):**
1. `start-outbound-video` returns `{ callId, channelName }` (not a token) — the agent fetches its token from the existing dual-auth `/api/video/token`, which already mints agent-session tokens. DRY; no duplicated token minting.
2. `end-video` is **generalized** to also finalize `RINGING → NO_ANSWER` (serves agent Cancel + the 30s timeout) and to reset presence — this single change fixes `task_71d65b0a` and serves outbound. The reaper gets the same presence reset for the crash/throttle case (which is literally the bug's description).
3. **`incoming-video` (agent inbound feed) must exclude `OUTBOUND`** or the originating agent's own call rings them back as an inbound call. Non-negotiable; landed with the originate route.
4. Kiosk answer uses a **new atomic claim** (`claimOutboundByKiosk`), not `claimCall` — `claimCall` overwrites `handled_by_user_id`, which for an outbound call is the *originating agent* and must be preserved.
5. Outbound stays on the **full-screen overlay** in v1 (no DocPiP tile auto-open — DocPiP needs a user gesture, and there's no gesture at kiosk-answer time). The tile still works if opened manually; auto-open for outbound is a v2 seam.
6. Kiosk liveness read is **fresh-only** (`isKioskOnline`) — the 30s heartbeat runs on *every* kiosk screen (including mid-call), so a live call stays fresh within the 90s window without a separate "on active call" clause. Simpler and correct.

---

## File structure

**New files:**
- `supabase/migrations/0022_calls_direction.sql`, `supabase/migrations/0023_kiosks_liveness.sql`
- `apps/portal/app/api/calls/start-outbound-video/route.ts`
- `apps/portal/app/api/kiosk/incoming-call/route.ts`
- `apps/portal/app/api/kiosk/answer-call/route.ts`
- `apps/portal/lib/kiosk/liveness.ts` (pure `isKioskOnline`) + `apps/portal/lib/kiosk/stamp-liveness.ts` (server write helper)
- `apps/portal/components/dashboard/kiosk-call-button.tsx`
- `apps/portal/components/dashboard/call-back-shortcut.tsx`
- `apps/kiosk/src/screens/IncomingCall.tsx`
- Test files mirroring each (see tasks).

**Modified files:**
- `packages/shared/src/protocol.ts` (+constants +guards); `packages/shared/src/supabase-types.ts` (+`CallDirection` overlay); `packages/shared/src/database.generated.ts` (regenerated).
- `apps/portal/lib/voice/call-state.ts` (+`claimOutboundByKiosk`, +`resetPresenceAfterCall`).
- `apps/portal/lib/owner/format.ts`, `apps/portal/lib/owner/status-pill.ts`, `apps/portal/lib/dashboard/calls.ts` (direction-aware labels/counts).
- `apps/portal/app/api/calls/[id]/end-video/route.ts` (RINGING→NO_ANSWER + presence reset); `apps/portal/app/api/cron/reap-stale-calls/route.ts` (presence reset); `apps/portal/app/api/calls/incoming-video/route.ts` (exclude OUTBOUND); `apps/portal/app/api/kiosk/heartbeat/route.ts` (liveness write).
- `apps/portal/components/dashboard/call-surface-provider.tsx` (+`startOutboundVideo`, +`recentlyEnded`); `apps/portal/components/video-call/video-call-host.tsx` (outbound mount); `apps/portal/components/video-call/video-call.tsx` (outbound `"calling"` phase); `apps/portal/components/dashboard/pod-card-grid.tsx` + `apps/portal/components/dashboard/property-card.tsx` (Kiosk button + dot); `apps/portal/components/dashboard-workspace.tsx` (Call-back shortcut mount); the agent + admin dashboard pages (`kiosks` read); `apps/portal/app/(admin)/admin/status/page.tsx` (kiosk tile); the owner/admin/agent call-view surfaces (thread `direction`).
- `apps/kiosk/src/state/call-machine.ts` (incoming/answer/drop + lockout guard); `apps/kiosk/src/App.tsx` (poll + onAnswer + terminal-drop lockout); `apps/kiosk/src/lib/portal-api.ts` (`fetchIncomingCall`, `answerCall`); `apps/kiosk/src/screens/Home.tsx` (lockout message + disabled tap).

---

## Phase 1 — Foundation (migrations, types, protocol, pure helpers)

### Task 1: Migrations 0022 (`calls.direction`) + 0023 (`kiosks`) + regenerate types + overlay narrowing

**Files:**
- Create: `supabase/migrations/0022_calls_direction.sql`
- Create: `supabase/migrations/0023_kiosks_liveness.sql`
- Modify: `packages/shared/src/supabase-types.ts`
- Regenerate: `packages/shared/src/database.generated.ts`

- [ ] **Step 1: Write migration 0022** — `supabase/migrations/0022_calls_direction.sql`:

```sql
-- 0022_calls_direction.sql
-- Distinguish agent-initiated OUTBOUND video calls from guest-initiated INBOUND.
-- Additive + defaulted -> blue-green safe (the frozen Vercel/Agora standby ignores it).
alter table public.calls
  add column direction text not null default 'INBOUND'
    check (direction in ('INBOUND', 'OUTBOUND'));
```

- [ ] **Step 2: Write migration 0023** — `supabase/migrations/0023_kiosks_liveness.sql`:

```sql
-- 0023_kiosks_liveness.sql
-- Per-property kiosk liveness. A dedicated table keeps the 3-30s write cadence
-- off the read-heavy properties row. One kiosk per property today (config token is
-- property-scoped); forward-compatible with multiple. Writes are service-role only
-- (kiosk-token routes use the admin client); select is operator-scoped.
create table if not exists public.kiosks (
  id            uuid primary key default gen_random_uuid(),
  operator_id   uuid not null references operators(id),
  property_id   uuid not null references properties(id),
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now()
);

create unique index if not exists kiosks_one_per_property
  on public.kiosks(property_id);

alter table public.kiosks enable row level security;

-- Operator-scoped read (mirrors current_user_operator_id() usage in other policies).
create policy kiosks_select_operator on public.kiosks
  for select using (operator_id = current_user_operator_id());

-- No insert/update/delete policies: all writes go through the service-role admin client.
```

- [ ] **Step 3: Apply both migrations locally, then regenerate types.**

Run (needs Docker + Supabase CLI **2.101.0** pinned):
```bash
supabase start        # if not already running
supabase migration up # applies 0022 + 0023 to the local db
pnpm gen:types        # regenerates packages/shared/src/database.generated.ts
```
Expected: `database.generated.ts` now types `calls.Row.direction: string` and adds a `kiosks` table block. (If local Supabase is unavailable in this environment, apply 0022/0023 to the **staging** project via the Supabase MCP `apply_migration`, then `supabase gen types --project-id cgtvqjxhbojztzumshca` — but prefer local so nothing hits a shared DB.)

- [ ] **Step 4: Re-narrow `direction` in the overlay** — `packages/shared/src/supabase-types.ts`.

Add the union type near the other CHECK-column unions (beside `CallState`/`CallChannel`):
```ts
export type CallDirection = "INBOUND" | "OUTBOUND";
```
Then extend the `calls` override object (Row required, Insert/Update optional — 0022 has a default):
```ts
calls: {
  Row:    { channel: CallChannel; state: CallState; direction: CallDirection };
  Insert: { channel: CallChannel; state: CallState; direction?: CallDirection };
  Update: { channel?: CallChannel; state?: CallState; direction?: CallDirection };
};
```

- [ ] **Step 5: Verify types + drift.**

Run:
```bash
pnpm --filter @lc/shared typecheck   # or: pnpm typecheck
pnpm gen:types:check
```
Expected: PASS (generated file matches the applied migrations; overlay compiles).

- [ ] **Step 6: Commit.**

```bash
git add supabase/migrations/0022_calls_direction.sql supabase/migrations/0023_kiosks_liveness.sql \
        packages/shared/src/supabase-types.ts packages/shared/src/database.generated.ts
git commit -m "feat(db): calls.direction + kiosks liveness table (migrations 0022/0023)"
```

---

### Task 2: Protocol constants (outbound ring window, kiosk staleness, reconnect window) + guards

**Files:**
- Modify: `packages/shared/src/protocol.ts`
- Test: `packages/shared/tests/protocol.test.ts` (existing — extend it)

- [ ] **Step 1: Write the failing test.** Append to `packages/shared/tests/protocol.test.ts`:

```ts
import {
  OUTBOUND_RING_WINDOW_SECONDS,
  OUTBOUND_RING_WINDOW_MS,
  KIOSK_STALE_AFTER_MS,
  RECONNECT_WINDOW_MS,
  RING_WINDOW_MS,
  REAP_RINGING_AFTER_MS,
} from "../src/protocol";

describe("outbound + liveness protocol constants", () => {
  it("outbound ring window is 30s and shorter than the inbound window", () => {
    expect(OUTBOUND_RING_WINDOW_SECONDS).toBe(30);
    expect(OUTBOUND_RING_WINDOW_MS).toBe(30_000);
    expect(OUTBOUND_RING_WINDOW_MS).toBeLessThan(RING_WINDOW_MS);
  });
  it("outbound ring window is under the reaper ringing backstop", () => {
    expect(OUTBOUND_RING_WINDOW_MS).toBeLessThan(REAP_RINGING_AFTER_MS);
  });
  it("kiosk staleness is 90s (survives one missed 30s heartbeat)", () => {
    expect(KIOSK_STALE_AFTER_MS).toBe(90_000);
  });
  it("reconnect window is 10s", () => {
    expect(RECONNECT_WINDOW_MS).toBe(10_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm --filter @lc/shared test -- protocol`
Expected: FAIL — the new constants are not exported.

- [ ] **Step 3: Add the constants + guards** in `packages/shared/src/protocol.ts`. Add near the ring-window block:

```ts
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
```

Then add to the module-load guard block (near the existing `throw`s):
```ts
if (OUTBOUND_RING_WINDOW_MS >= REAP_RINGING_AFTER_MS) {
  throw new Error(
    "OUTBOUND_RING_WINDOW_MS must be under REAP_RINGING_AFTER_MS (the reaper is the backstop)",
  );
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `pnpm --filter @lc/shared test -- protocol`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/shared/src/protocol.ts packages/shared/tests/protocol.test.ts
git commit -m "feat(shared): outbound ring window, kiosk staleness, reconnect window constants"
```

---

### Task 3: Pure kiosk-liveness helper `isKioskOnline`

**Files:**
- Create: `apps/portal/lib/kiosk/liveness.ts`
- Test: `apps/portal/tests/lib/kiosk/liveness.test.ts`

- [ ] **Step 1: Write the failing test** — `apps/portal/tests/lib/kiosk/liveness.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isKioskOnline } from "@/lib/kiosk/liveness";
import { KIOSK_STALE_AFTER_MS } from "@lc/shared";

const NOW = 1_000_000_000_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("isKioskOnline", () => {
  it("null last_seen_at is offline", () => {
    expect(isKioskOnline(null, NOW)).toBe(false);
  });
  it("unparseable timestamp is offline", () => {
    expect(isKioskOnline("not-a-date", NOW)).toBe(false);
  });
  it("a fresh heartbeat is online", () => {
    expect(isKioskOnline(iso(5_000), NOW)).toBe(true);
  });
  it("exactly at the staleness threshold is still online (inclusive)", () => {
    expect(isKioskOnline(iso(KIOSK_STALE_AFTER_MS), NOW)).toBe(true);
  });
  it("past the staleness threshold is offline", () => {
    expect(isKioskOnline(iso(KIOSK_STALE_AFTER_MS + 1), NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm --filter @lc/portal test -- kiosk/liveness`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/portal/lib/kiosk/liveness.ts`:

```ts
import { KIOSK_STALE_AFTER_MS } from "@lc/shared";

/**
 * A kiosk is online iff its last heartbeat/poll is within the staleness window.
 * Mirrors the read-time shape of effectivePresence/isStale for agent presence.
 * Fresh-only: the 30s kiosk heartbeat runs on every screen (incl. mid-call), so a
 * live call stays fresh inside the 90s window without a separate "on active call" clause.
 */
export function isKioskOnline(lastSeenAt: string | null, nowMs: number): boolean {
  if (!lastSeenAt) return false;
  const seen = Date.parse(lastSeenAt);
  if (Number.isNaN(seen)) return false;
  return nowMs - seen <= KIOSK_STALE_AFTER_MS;
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `pnpm --filter @lc/portal test -- kiosk/liveness`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/portal/lib/kiosk/liveness.ts apps/portal/tests/lib/kiosk/liveness.test.ts
git commit -m "feat(kiosk): pure isKioskOnline liveness helper"
```

### Task 4: Direction-aware labeling + counts (pure) — outbound NO_ANSWER ≠ "Missed"

Makes the label/pill/count helpers accept an optional `direction` that defaults to `"INBOUND"`, so **every existing caller stays byte-identical** until Task 17 threads a real direction. OUTBOUND + NO_ANSWER renders "No answer" with a neutral pill (not "Missed"/blaze) and is excluded from missed counts. (Spec §9, D10.)

**Files:**
- Modify: `apps/portal/lib/owner/format.ts` (`callStateLabel`)
- Modify: `apps/portal/lib/owner/status-pill.ts` (`callPill`)
- Modify: `apps/portal/lib/dashboard/calls.ts` (`countByOutcome`, `hourlyVolume`; add pure `outcomeDotClass`)
- Test: `apps/portal/tests/lib/owner/direction-labels.test.ts` (new); extend `apps/portal/tests/lib/dashboard/calls.test.ts` (existing)

- [ ] **Step 1: Write the failing tests** — `apps/portal/tests/lib/owner/direction-labels.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { callStateLabel } from "@/lib/owner/format";
import { callPill } from "@/lib/owner/status-pill";

describe("direction-aware call labels", () => {
  it("inbound NO_ANSWER stays 'Missed' (default direction unchanged)", () => {
    expect(callStateLabel("NO_ANSWER")).toBe("Missed");
    expect(callStateLabel("NO_ANSWER", "INBOUND")).toBe("Missed");
  });
  it("outbound NO_ANSWER reads 'No answer', not 'Missed'", () => {
    expect(callStateLabel("NO_ANSWER", "OUTBOUND")).toBe("No answer");
  });
  it("non-NO_ANSWER states are unaffected by direction", () => {
    expect(callStateLabel("COMPLETED", "OUTBOUND")).toBe(callStateLabel("COMPLETED"));
  });
  it("outbound NO_ANSWER pill is not the blaze/attention class", () => {
    const inbound = callPill("NO_ANSWER", "INBOUND");
    const outbound = callPill("NO_ANSWER", "OUTBOUND");
    expect(inbound.className).toContain("attention");
    expect(outbound.className).not.toContain("attention");
    expect(outbound.label).toBe("No answer");
  });
});
```

Add to `apps/portal/tests/lib/dashboard/calls.test.ts` (a `countByOutcome` case):
```ts
it("an OUTBOUND NO_ANSWER is not counted as missed", () => {
  const rows = [
    { state: "NO_ANSWER", direction: "OUTBOUND", channel: "VIDEO", created_at: new Date().toISOString() },
    { state: "NO_ANSWER", direction: "INBOUND", channel: "AUDIO", created_at: new Date().toISOString() },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expect(countByOutcome(rows as any).missed).toBe(1);
});
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `pnpm --filter @lc/portal test -- "owner/direction-labels|dashboard/calls"`
Expected: FAIL — `callStateLabel`/`callPill` take one arg; `countByOutcome` ignores direction.

- [ ] **Step 3: Implement.**

`apps/portal/lib/owner/format.ts` — widen `callStateLabel` (keep the existing `CALL_STATE_LABELS` map; import `CallDirection`):
```ts
import type { CallState, CallDirection } from "@lc/shared";

export function callStateLabel(state: CallState, direction: CallDirection = "INBOUND"): string {
  if (state === "NO_ANSWER" && direction === "OUTBOUND") return "No answer";
  return CALL_STATE_LABELS[state] ?? state;
}
```

`apps/portal/lib/owner/status-pill.ts` — widen `callPill` (return the same `{ label, className }` shape it already returns):
```ts
import type { CallState, CallDirection } from "@lc/shared";

export function callPill(state: CallState, direction: CallDirection = "INBOUND") {
  if (state === "NO_ANSWER" && direction === "OUTBOUND") {
    return { label: "No answer", className: "bg-muted text-muted-foreground" };
  }
  return { label: callStateLabel(state), className: CALL_PILL_CLASS[state] };
}
```
(Preserve the existing import of `callStateLabel` / `CALL_PILL_CLASS`; only the signature + the OUTBOUND branch are new.)

`apps/portal/lib/dashboard/calls.ts` — the row types gain an optional `direction`; the `missed` bucket skips OUTBOUND NO_ANSWER. Locate `countByOutcome` (its `NO_ANSWER -> counts.missed++`) and guard it:
```ts
// inside the per-row switch/branch for NO_ANSWER:
if (row.state === "NO_ANSWER") {
  if (row.direction === "OUTBOUND") continue; // outbound no-answer is not a "missed" guest call
  counts.missed++;
}
```
Do the same guard in `hourlyVolume` (the `NO_ANSWER -> bucket.missed` line). Widen the row input type to include `direction?: CallDirection`. Then extract the inline dot-class map into a pure export (recent-call-row will import it in Task 17):
```ts
import type { CallState, CallDirection } from "@lc/shared";

export function outcomeDotClass(state: CallState, direction: CallDirection = "INBOUND"): string {
  if (state === "NO_ANSWER" && direction === "OUTBOUND") return "bg-muted-foreground/40";
  // (paste the existing state->class map body here, unchanged)
  ...
}
```

- [ ] **Step 4: Run tests to verify they pass.**

Run: `pnpm --filter @lc/portal test -- "owner/direction-labels|dashboard/calls"`
Expected: PASS. Also run the full portal suite to confirm no existing label/count test regressed (they all use the default direction): `pnpm --filter @lc/portal test`.

- [ ] **Step 5: Commit.**

```bash
git add apps/portal/lib/owner/format.ts apps/portal/lib/owner/status-pill.ts \
        apps/portal/lib/dashboard/calls.ts apps/portal/tests/lib/owner/direction-labels.test.ts \
        apps/portal/tests/lib/dashboard/calls.test.ts
git commit -m "feat(calls): direction-aware labels/pills/counts (outbound NO_ANSWER is not 'Missed')"
```

---

## Phase 2 — Server routes + finalization/presence fix

### Task 5: `POST /api/calls/start-outbound-video` + exclude OUTBOUND from the agent inbound feed

**Files:**
- Create: `apps/portal/app/api/calls/start-outbound-video/route.ts`
- Modify: `apps/portal/app/api/calls/incoming-video/route.ts` (add `.eq("direction", "INBOUND")`)
- Smoke (no unit test for the route wiring; pure logic is reused from existing tested helpers)

- [ ] **Step 1: Write the route** — `apps/portal/app/api/calls/start-outbound-video/route.ts`. Model it on `app/api/kiosk/call-started/route.ts` (the only VIDEO-insert site) but session-authed and agent-originated:

```ts
import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import { requireApiActor } from "@/lib/auth/api-actor";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOnDuty } from "@/lib/shifts/gate";
import { broadcastCallsChanged } from "@/lib/realtime/broadcast"; // (use the actual import path used by call-started/answer-video)

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actor instanceof NextResponse) return actor;

  const admin = createAdminClient();

  // An off-duty agent must not ring a kiosk (mirrors answer-video's shift gate).
  const gate = await requireOnDuty(admin, actor.userId);
  if (gate) return gate;

  const body = (await request.json().catch(() => ({}))) as { propertyId?: string };
  const propertyId = body.propertyId;
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
  }

  // Property must exist, be active, and belong to the actor's operator.
  const { data: property } = await admin
    .from("properties")
    .select("id, operator_id, active, name")
    .eq("id", propertyId)
    .eq("operator_id", actor.operatorId)
    .maybeSingle();
  if (!property || property.active === false) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const channelName = `call_${randomUUID().replace(/-/g, "")}`;

  const { data: inserted, error: insertError } = await admin
    .from("calls")
    .insert({
      operator_id: property.operator_id,
      property_id: property.id,
      channel: "VIDEO",
      state: "RINGING",
      direction: "OUTBOUND",
      agora_channel_name: channelName,
      handled_by_user_id: actor.userId,
    })
    .select("id")
    .single();

  if (insertError) {
    // One-active-call index (0016): a call is already live for this property.
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "A call is already active for this property" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not start call" }, { status: 500 });
  }

  // The originating agent goes ON_CALL immediately (reset on end — Task 8).
  await admin.from("profiles").update({ status: "ON_CALL" }).eq("id", actor.userId);

  after(() => {
    void broadcastCallsChanged(actor.operatorId); // update card live-state; NO push (this is the agent's own call)
  });

  return NextResponse.json({ callId: inserted.id, channelName });
}
```

> Implementation notes for the subagent: confirm the exact import for `broadcastCallsChanged` and `after` by reading `app/api/kiosk/call-started/route.ts` and `app/api/calls/[id]/answer-video/route.ts` and match them verbatim. Do **not** call `sendCallPush` here (unlike inbound) — an outbound call must not push-ring agents.

- [ ] **Step 2: Exclude OUTBOUND from the agent inbound feed** — `apps/portal/app/api/calls/incoming-video/route.ts`. Locate the `calls` query (filters `channel='VIDEO'`, `state='RINGING'`, `property_id in scope`, `ring_started_at >= ...`) and add:
```ts
.eq("direction", "INBOUND")
```
This prevents an agent's own outbound RINGING row (and any OUTBOUND row) from surfacing as an incoming call anywhere.

- [ ] **Step 3: Verify build + types.**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal build && pnpm check:routes`
Expected: PASS (new route compiles; `typedRoutes` picks up `/api/calls/start-outbound-video`).

- [ ] **Step 4: Add a light guard test (optional but preferred).** If the codebase has any route-handler test harness, add one asserting a `409` maps from a `23505`. Otherwise rely on staging smoke (Task 18). Do not fabricate a harness that doesn't exist — check `apps/portal/tests/` for an existing route test pattern first; skip if none.

- [ ] **Step 5: Commit.**

```bash
git add apps/portal/app/api/calls/start-outbound-video/route.ts apps/portal/app/api/calls/incoming-video/route.ts
git commit -m "feat(calls): start-outbound-video route; exclude OUTBOUND from the agent inbound feed"
```

---

### Task 6: `GET /api/kiosk/incoming-call` (discovery poll + liveness) + `stampKioskLiveness` + heartbeat write

**Files:**
- Create: `apps/portal/app/api/kiosk/incoming-call/route.ts`
- Create: `apps/portal/lib/kiosk/stamp-liveness.ts`
- Modify: `apps/portal/app/api/kiosk/heartbeat/route.ts` (call the stamp helper)
- Test: `apps/portal/tests/lib/kiosk/stamp-liveness.test.ts` (mocked admin client)

- [ ] **Step 1: Write the failing test** — `apps/portal/tests/lib/kiosk/stamp-liveness.test.ts`. Assert the helper resolves `operator_id` from the property then upserts by `property_id`:

```ts
import { describe, it, expect, vi } from "vitest";
import { stampKioskLiveness } from "@/lib/kiosk/stamp-liveness";

function makeAdmin(operatorId: string | null) {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    if (table === "properties") {
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: operatorId ? { operator_id: operatorId } : null }) }) }),
      };
    }
    return { upsert };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, upsert };
}

describe("stampKioskLiveness", () => {
  it("upserts last_seen_at by property_id with the resolved operator", async () => {
    const { client, upsert } = makeAdmin("op-1");
    await stampKioskLiveness(client, "prop-1");
    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, opts] = upsert.mock.calls[0];
    expect(row).toMatchObject({ operator_id: "op-1", property_id: "prop-1" });
    expect(typeof row.last_seen_at).toBe("string");
    expect(opts).toMatchObject({ onConflict: "property_id" });
  });
  it("no-ops when the property has no operator (defensive)", async () => {
    const { client, upsert } = makeAdmin(null);
    await stampKioskLiveness(client, "prop-x");
    expect(upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm --filter @lc/portal test -- kiosk/stamp-liveness`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `stampKioskLiveness`** — `apps/portal/lib/kiosk/stamp-liveness.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@lc/shared";

type Admin = SupabaseClient<Database>;

/**
 * Upsert kiosks.last_seen_at = now() for a property, resolving operator_id on first
 * insert. Best-effort (callers detach it). Service-role client only (RLS blocks writes).
 */
export async function stampKioskLiveness(admin: Admin, propertyId: string): Promise<void> {
  const { data: property } = await admin
    .from("properties")
    .select("operator_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (!property) return;
  await admin
    .from("kiosks")
    .upsert(
      { operator_id: property.operator_id, property_id: propertyId, last_seen_at: new Date().toISOString() },
      { onConflict: "property_id" },
    );
}
```

- [ ] **Step 4: Write the `incoming-call` route** — `apps/portal/app/api/kiosk/incoming-call/route.ts`. Kiosk-token auth (mirror `heartbeat`/`call-ended`), return the fresh OUTBOUND RINGING call or null, stamp liveness after responding:

```ts
import { NextResponse, after } from "next/server";
import { verifyKioskToken, getKioskConfigSecret } from "@/lib/kiosk/config-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { stampKioskLiveness } from "@/lib/kiosk/stamp-liveness";
import { OUTBOUND_RING_WINDOW_MS } from "@lc/shared";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const token = request.headers.get("x-kiosk-token") ?? "";
  const verified = verifyKioskToken(token, getKioskConfigSecret());
  if (!verified) {
    return NextResponse.json({ error: "Invalid kiosk token" }, { status: 401 });
  }

  const admin = createAdminClient();
  const freshSince = new Date(Date.now() - OUTBOUND_RING_WINDOW_MS).toISOString();

  const { data: call } = await admin
    .from("calls")
    .select("id, agora_channel_name")
    .eq("property_id", verified.propertyId)
    .eq("channel", "VIDEO")
    .eq("direction", "OUTBOUND")
    .eq("state", "RINGING")
    .gte("ring_started_at", freshSince)
    .order("ring_started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  after(() => void stampKioskLiveness(admin, verified.propertyId).catch(() => {}));

  if (!call || !call.agora_channel_name) {
    return NextResponse.json(null);
  }
  return NextResponse.json({ callId: call.id, channelName: call.agora_channel_name });
}
```

- [ ] **Step 5: Wire liveness into the heartbeat** — `apps/portal/app/api/kiosk/heartbeat/route.ts`. Replace the no-op comment/return with a liveness stamp (keep the 204):
```ts
// after the verifyKioskToken guard:
const admin = createAdminClient();
after(() => void stampKioskLiveness(admin, verified.propertyId).catch(() => {}));
return new NextResponse(null, { status: 204 });
```
(Import `createAdminClient`, `stampKioskLiveness`, and `after`; `verified` is the `verifyKioskToken` result — capture it into a variable like the other kiosk routes do.)

- [ ] **Step 6: Run tests + build.**

Run: `pnpm --filter @lc/portal test -- kiosk/stamp-liveness && pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal build && pnpm check:routes`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/portal/app/api/kiosk/incoming-call/route.ts apps/portal/lib/kiosk/stamp-liveness.ts \
        apps/portal/app/api/kiosk/heartbeat/route.ts apps/portal/tests/lib/kiosk/stamp-liveness.test.ts
git commit -m "feat(kiosk): incoming-call discovery poll + kiosk liveness writes"
```

---

### Task 7: `POST /api/kiosk/answer-call` + `claimOutboundByKiosk`

The kiosk-side mirror of the agent's `answer-video`. Uses a distinct claim that preserves `handled_by_user_id` (the originating agent).

**Files:**
- Create: `apps/portal/app/api/kiosk/answer-call/route.ts`
- Modify: `apps/portal/lib/voice/call-state.ts` (+`claimOutboundByKiosk`)
- Test: `apps/portal/tests/lib/voice/claim-outbound.test.ts` (mocked admin client)

- [ ] **Step 1: Write the failing test** — `apps/portal/tests/lib/voice/claim-outbound.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { claimOutboundByKiosk } from "@/lib/voice/call-state";

function makeAdmin(rows: unknown[]) {
  const select = vi.fn().mockResolvedValue({ data: rows });
  const chain: Record<string, unknown> = {};
  for (const m of ["update", "eq"]) chain[m] = vi.fn(() => chain);
  chain.select = select;
  const from = vi.fn(() => chain);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, chain };
}

describe("claimOutboundByKiosk", () => {
  it("returns the channel when the RINGING outbound row is claimed", async () => {
    const { client, chain } = makeAdmin([{ id: "c1", agora_channel_name: "call_abc" }]);
    const res = await claimOutboundByKiosk(client, "c1", "prop-1");
    expect(res).toEqual({ channelName: "call_abc" });
    // never touches handled_by_user_id
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ state: "IN_PROGRESS" }),
    );
    const updateArg = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArg).not.toHaveProperty("handled_by_user_id");
  });
  it("returns null when nothing was claimed (already answered/cancelled/timed out)", async () => {
    const { client } = makeAdmin([]);
    expect(await claimOutboundByKiosk(client, "c1", "prop-1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm --filter @lc/portal test -- voice/claim-outbound`
Expected: FAIL — `claimOutboundByKiosk` not exported.

- [ ] **Step 3: Implement `claimOutboundByKiosk`** in `apps/portal/lib/voice/call-state.ts` (near `claimCall`):

```ts
/**
 * Kiosk-side atomic claim of an OUTBOUND call: RINGING -> IN_PROGRESS + answered_at,
 * scoped to the property + direction. Unlike claimCall it does NOT set handled_by_user_id
 * (already the originating agent). Returns { channelName } on success, null if not claimed.
 */
export async function claimOutboundByKiosk(
  admin: Admin,
  callId: string,
  propertyId: string,
): Promise<{ channelName: string } | null> {
  const { data } = await admin
    .from("calls")
    .update({ state: "IN_PROGRESS", answered_at: new Date().toISOString() })
    .eq("id", callId)
    .eq("property_id", propertyId)
    .eq("direction", "OUTBOUND")
    .eq("state", "RINGING")
    .select("id, agora_channel_name");
  const row = data?.[0];
  if (!row || !row.agora_channel_name) return null;
  return { channelName: row.agora_channel_name };
}
```
(Use whatever `Admin` type alias `claimCall` already uses in this file.)

- [ ] **Step 4: Write the route** — `apps/portal/app/api/kiosk/answer-call/route.ts`:

```ts
import { NextResponse, after } from "next/server";
import { verifyKioskToken, getKioskConfigSecret } from "@/lib/kiosk/config-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimOutboundByKiosk } from "@/lib/voice/call-state";
import { broadcastCallsChanged } from "@/lib/realtime/broadcast"; // match call-ended's import

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const token = request.headers.get("x-kiosk-token") ?? "";
  const verified = verifyKioskToken(token, getKioskConfigSecret());
  if (!verified) {
    return NextResponse.json({ error: "Invalid kiosk token" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { callId?: string };
  if (!body.callId) {
    return NextResponse.json({ error: "callId is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const claimed = await claimOutboundByKiosk(admin, body.callId, verified.propertyId);
  if (!claimed) {
    // No longer RINGING: agent cancelled, timed out, or a double-tap lost the race.
    return NextResponse.json({ error: "Call is no longer available" }, { status: 409 });
  }

  after(() => {
    // resolve operator for the broadcast the same way call-ended does, or select it inline
    void broadcastCallsChanged(verified.propertyId /* -> operatorId; match call-ended */);
  });

  return NextResponse.json({ channelName: claimed.channelName });
}
```
> Subagent note: `call-ended` broadcasts with the **operator_id**, not property_id. Fetch `operator_id` from the claimed call (add it to the `claimOutboundByKiosk` select) or a small `properties` lookup, and pass that to `broadcastCallsChanged`. Match `call-ended`'s exact broadcast signature.

- [ ] **Step 5: Run test + build.**

Run: `pnpm --filter @lc/portal test -- voice/claim-outbound && pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal build && pnpm check:routes`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/portal/app/api/kiosk/answer-call/route.ts apps/portal/lib/voice/call-state.ts \
        apps/portal/tests/lib/voice/claim-outbound.test.ts
git commit -m "feat(kiosk): answer-call route + claimOutboundByKiosk (preserves handled_by agent)"
```

---

### Task 8: Generalize `end-video` (RINGING→NO_ANSWER) + presence reset (fixes `task_71d65b0a`) + reaper reset

**Files:**
- Modify: `apps/portal/lib/voice/call-state.ts` (+`resetPresenceAfterCall`)
- Modify: `apps/portal/app/api/calls/[id]/end-video/route.ts`
- Modify: `apps/portal/app/api/cron/reap-stale-calls/route.ts`
- Test: `apps/portal/tests/lib/voice/reset-presence.test.ts` (mocked admin client)

- [ ] **Step 1: Write the failing test** — `apps/portal/tests/lib/voice/reset-presence.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { resetPresenceAfterCall } from "@/lib/voice/call-state";

function makeAdmin() {
  const chain: Record<string, unknown> = {};
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  const from = vi.fn(() => chain);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, chain };
}

describe("resetPresenceAfterCall", () => {
  it("flips ON_CALL -> AVAILABLE, guarded so it never clobbers AWAY/BREAK/OFFLINE", async () => {
    const { client, chain } = makeAdmin();
    await resetPresenceAfterCall(client, "user-1");
    expect(chain.update).toHaveBeenCalledWith({ status: "AVAILABLE" });
    // must be guarded on id + status='ON_CALL'
    expect(chain.eq).toHaveBeenCalledWith("id", "user-1");
    expect(chain.eq).toHaveBeenCalledWith("status", "ON_CALL");
  });
  it("no-ops for a null user", async () => {
    const { client, chain } = makeAdmin();
    await resetPresenceAfterCall(client, null);
    expect(chain.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm --filter @lc/portal test -- voice/reset-presence`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement `resetPresenceAfterCall`** in `apps/portal/lib/voice/call-state.ts`:

```ts
/**
 * Reset a just-finished agent from ON_CALL back to AVAILABLE. Guarded on
 * status='ON_CALL' so it never clobbers AWAY/BREAK/OFFLINE or a concurrent second call.
 * Service-role client only (0012 column guard blocks user-scoped status writes).
 * Fixes task_71d65b0a — inbound end paths never reset presence, so agents stuck ON_CALL.
 */
export async function resetPresenceAfterCall(admin: Admin, userId: string | null): Promise<void> {
  if (!userId) return;
  await admin.from("profiles").update({ status: "AVAILABLE" }).eq("id", userId).eq("status", "ON_CALL");
}
```

- [ ] **Step 4: Generalize `end-video`** — `apps/portal/app/api/calls/[id]/end-video/route.ts`. It currently only finalizes `IN_PROGRESS`. Add a `RINGING → NO_ANSWER` branch (agent Cancel / 30s outbound timeout) and reset the actor's presence unconditionally after. Replace the `if (call.state === "IN_PROGRESS") { ... }` block with:

```ts
const admin = createAdminClient();
if (call.state === "IN_PROGRESS") {
  const endedAt = new Date();
  await admin.from("calls")
    .update(finalizeCallPayload("COMPLETED", call.answered_at, endedAt))
    .eq("id", id)
    .eq("state", "IN_PROGRESS");
  after(() => {
    void broadcastCallsChanged(actor.operatorId);
    void sendCallPush(admin, { type: "call-cleared", callId: id, channel: "VIDEO", propertyId: call.property_id, propertyName: "" });
  });
} else if (call.state === "RINGING") {
  // Outbound agent cancelled or the 30s ring window elapsed — never connected.
  const endedAt = new Date();
  await admin.from("calls")
    .update(finalizeCallPayload("NO_ANSWER", null, endedAt))
    .eq("id", id)
    .eq("state", "RINGING");
  after(() => void broadcastCallsChanged(actor.operatorId));
}

// Always release the actor's presence (fixes task_71d65b0a for inbound + outbound).
await resetPresenceAfterCall(admin, actor.userId);
```
Import `resetPresenceAfterCall`. Keep the existing `createAdminClient` (now hoisted above the branch). Verify `finalizeCallPayload("NO_ANSWER", null, endedAt)` yields `duration_seconds: null` (never connected) — read `finalizeCallPayload` to confirm the null-answeredAt path.

- [ ] **Step 5: Reset presence in the reaper** — `apps/portal/app/api/cron/reap-stale-calls/route.ts`. Add `handled_by_user_id` to both sweeps' `select`, and after finalizing each stale row, reset its handler's presence (the crash/throttle case the bug describes). In each per-row finalize block add:
```ts
await resetPresenceAfterCall(admin, row.handled_by_user_id ?? null);
```
Import `resetPresenceAfterCall`. (Guarded on ON_CALL, so resetting a handler who already moved on is a harmless no-op.)

- [ ] **Step 6: Run test + full suite + build.**

Run: `pnpm --filter @lc/portal test -- voice/reset-presence && pnpm --filter @lc/portal test && pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal build`
Expected: PASS. (Confirm no existing end-video/reaper test broke — if a reaper test asserts an exact select column list, update it to include `handled_by_user_id`.)

- [ ] **Step 7: Commit.**

```bash
git add apps/portal/lib/voice/call-state.ts apps/portal/app/api/calls/[id]/end-video/route.ts \
        apps/portal/app/api/cron/reap-stale-calls/route.ts apps/portal/tests/lib/voice/reset-presence.test.ts
git commit -m "fix(presence): reset ON_CALL on call end + reaper; end-video finalizes RINGING outbound (task_71d65b0a)"
```

## Phase 3 — Kiosk UI

### Task 9: Kiosk reducer — `incoming` state + `INCOMING_CALL`/`ANSWER`/`DROP` actions + `isLockedOut` guard

**Files:**
- Modify: `apps/kiosk/src/state/call-machine.ts`
- Test: `apps/kiosk/tests/state/call-machine.test.ts` (existing — extend)

- [ ] **Step 1: Write the failing tests.** Append to `apps/kiosk/tests/state/call-machine.test.ts`:

```ts
import { reduce, initialState, isLockedOut, type KioskState } from "@/state/call-machine";

describe("outbound incoming-call transitions", () => {
  it("INCOMING_CALL moves home -> incoming and stores the call", () => {
    const s = reduce(initialState(), { type: "INCOMING_CALL", callId: "c1", channelName: "call_abc" });
    expect(s.screen).toBe("incoming");
    expect(s.callId).toBe("c1");
    expect(s.channelName).toBe("call_abc");
  });
  it("INCOMING_CALL is ignored when not on home (already in a call)", () => {
    const connected: KioskState = { screen: "connected", callId: "x", channelName: "call_x" };
    const s = reduce(connected, { type: "INCOMING_CALL", callId: "c2", channelName: "call_y" });
    expect(s).toEqual(connected);
  });
  it("ANSWER moves incoming -> ringing (the connecting screen), keeping the call", () => {
    const incoming: KioskState = { screen: "incoming", callId: "c1", channelName: "call_abc" };
    const s = reduce(incoming, { type: "ANSWER" });
    expect(s.screen).toBe("ringing");
    expect(s.callId).toBe("c1");
    expect(s.channelName).toBe("call_abc");
  });
  it("ANSWER is a no-op unless on the incoming screen", () => {
    const home = initialState();
    expect(reduce(home, { type: "ANSWER" })).toEqual(home);
  });
  it("AGENT_JOINED still moves ringing -> connected (reused for the answer path)", () => {
    const ringing: KioskState = { screen: "ringing", callId: "c1", channelName: "call_abc" };
    expect(reduce(ringing, { type: "AGENT_JOINED" }).screen).toBe("connected");
  });
  it("DROP returns to home from any state", () => {
    const connected: KioskState = { screen: "connected", callId: "x", channelName: "call_x" };
    expect(reduce(connected, { type: "DROP" })).toEqual(initialState());
  });
});

describe("isLockedOut", () => {
  const NOW = 1_000_000;
  it("no lockout timestamp -> not locked", () => {
    expect(isLockedOut(null, NOW)).toBe(false);
  });
  it("before the lockout expiry -> locked", () => {
    expect(isLockedOut(NOW + 5_000, NOW)).toBe(true);
  });
  it("at/after expiry -> not locked", () => {
    expect(isLockedOut(NOW, NOW)).toBe(false);
    expect(isLockedOut(NOW - 1, NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `pnpm --filter @lc/kiosk test -- call-machine`
Expected: FAIL — `incoming` screen, the new actions, and `isLockedOut` don't exist.

- [ ] **Step 3: Implement the reducer changes** in `apps/kiosk/src/state/call-machine.ts`:

Extend the screen + action types:
```ts
export type KioskScreen = "home" | "incoming" | "ringing" | "connected" | "apology";

export type KioskAction =
  | { type: "TAP_CALL" }
  | { type: "INCOMING_CALL"; callId: string; channelName: string }
  | { type: "ANSWER" }
  | { type: "CALL_STARTED"; callId: string; channelName: string }
  | { type: "AGENT_JOINED" }
  | { type: "RING_TIMEOUT" }
  | { type: "CANCEL" }
  | { type: "END_CALL" }
  | { type: "DROP" }
  | { type: "DISMISS_APOLOGY" }
  | { type: "ERROR" };
```

Add the cases in `reduce` (mirror the existing guard style):
```ts
case "INCOMING_CALL":
  // Only ring an idle kiosk; ignore if mid-call (an active call owns the screen).
  return state.screen === "home"
    ? { screen: "incoming", callId: action.callId, channelName: action.channelName }
    : state;

case "ANSWER":
  // Tap Answer -> reuse the "ringing" connecting screen; AGENT_JOINED -> connected.
  return state.screen === "incoming" ? { ...state, screen: "ringing" } : state;

case "DROP":
  // Terminal mid-call drop -> home (App layers the 10s tap lockout separately).
  return initialState();
```

Add the pure guard (near `shouldFireRingTimeout`):
```ts
/** True while a post-drop tap lockout is still in effect. */
export function isLockedOut(lockedUntilMs: number | null, nowMs: number): boolean {
  return lockedUntilMs != null && nowMs < lockedUntilMs;
}
```

- [ ] **Step 4: Run tests to verify they pass.**

Run: `pnpm --filter @lc/kiosk test -- call-machine`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/kiosk/src/state/call-machine.ts apps/kiosk/tests/state/call-machine.test.ts
git commit -m "feat(kiosk): reducer incoming/answer/drop transitions + isLockedOut guard"
```

---

### Task 10: Kiosk incoming-call poll + Answer flow + `IncomingCall` screen

**Files:**
- Modify: `apps/kiosk/src/lib/portal-api.ts` (+`fetchIncomingCall`, +`answerCall`)
- Create: `apps/kiosk/src/screens/IncomingCall.tsx`
- Modify: `apps/kiosk/src/App.tsx` (3s home poll + `onAnswer` handler + render the screen)
- Modify: `apps/kiosk/src/lib/copy.ts` (incoming-screen strings)
- Test: `apps/kiosk/tests/app-incoming-answer.test.tsx` (jsdom)

- [ ] **Step 1: Add the API calls** — `apps/kiosk/src/lib/portal-api.ts` (mirror `fetchVideoToken`/`sendHeartbeat`):

```ts
export async function fetchIncomingCall(): Promise<{ callId: string; channelName: string } | null> {
  const res = await fetch(`${getPortalApiBase()}/api/kiosk/incoming-call`, { headers: headers() }).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json()) as { callId: string; channelName: string } | null;
}

export async function answerCall(callId: string): Promise<{ channelName: string } | null> {
  const res = await fetch(`${getPortalApiBase()}/api/kiosk/answer-call`, {
    method: "POST",
    headers: { ...headers(), "content-type": "application/json" },
    body: JSON.stringify({ callId }),
  }).catch(() => null);
  if (!res || !res.ok) return null; // 409 (gone) -> null
  return (await res.json()) as { channelName: string };
}
```
(Use the file's existing `headers()` and `getPortalApiBase()` helpers.)

- [ ] **Step 2: Add copy** — `apps/kiosk/src/lib/copy.ts`, an `incoming` block:
```ts
incoming: {
  title: "The front desk is calling",
  subtitle: "Tap Answer to connect",
  answer: "Answer",
},
```

- [ ] **Step 3: Write the `IncomingCall` screen** — `apps/kiosk/src/screens/IncomingCall.tsx`. Model it on `Home.tsx`/`Ringing.tsx` visual language (brand seam, big legible CTA). Full-screen, one prominent **Answer** button:

```tsx
import { PhoneIncoming } from "lucide-react";
import { copy } from "@/lib/copy";
import { SeamTop } from "@/components/brand";

export function IncomingCall({ onAnswer }: { onAnswer: () => void }) {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center gap-8 bg-[var(--gradient-brand-panel)] text-center">
      <SeamTop />
      <PhoneIncoming className="h-16 w-16 animate-pulse" aria-hidden />
      <div>
        <h1 className="text-4xl font-semibold">{copy.incoming.title}</h1>
        <p className="mt-2 text-xl opacity-80">{copy.incoming.subtitle}</p>
      </div>
      <button
        type="button"
        onClick={onAnswer}
        className="rounded-full bg-live px-12 py-5 text-2xl font-semibold text-[var(--color-call)] shadow-lg"
      >
        {copy.incoming.answer}
      </button>
    </div>
  );
}
```
(Match the actual token/class vocabulary in the kiosk's other screens — the subagent should read `Ringing.tsx` and reuse its container/seam classes verbatim rather than inventing new ones. Keep the Answer button visually distinct and thumb-sized for a tablet.)

- [ ] **Step 4: Wire the poll + Answer into `App.tsx`.**

Add a home-only discovery poll effect (near the heartbeat effect). Poll every 3s only while on Home and not locked out is fine — but per spec the poll must also run **during** the lockout so a call-back lands; so gate the poll on `screen === "home"` only (lockout does not stop discovery):
```tsx
const INCOMING_POLL_MS = 3_000;
useEffect(() => {
  if (state.screen !== "home") return;
  let active = true;
  const check = async () => {
    const incoming = await fetchIncomingCall();
    if (active && incoming) {
      dispatch({ type: "INCOMING_CALL", callId: incoming.callId, channelName: incoming.channelName });
    }
  };
  void check();
  const id = setInterval(() => void check(), INCOMING_POLL_MS);
  return () => { active = false; clearInterval(id); };
}, [state.screen]);
```

Add the `onAnswer` handler (models `onStartCall`, but answers instead of originating — no ring timeout, agent already in the room):
```tsx
const onAnswer = useCallback(async () => {
  unlockAudioPlayback();
  const gen = ++callGenRef.current;
  const aborted = () => callGenRef.current !== gen;
  const callId = state.callId;
  const channelName = state.channelName;
  if (!callId || !channelName) return;

  const claimed = await answerCall(callId);
  if (!claimed) { dispatch({ type: "END_CALL" }); return; } // 409 -> call gone -> home
  dispatch({ type: "ANSWER" }); // incoming -> ringing (connecting)

  try {
    const uid = Math.floor(Math.random() * 1_000_000) + 1;
    const tok = await fetchVideoToken(claimed.channelName, uid);
    if (aborted()) return;
    const session = await joinLiveKit({ url: tok.url, token: tok.token, ...callbacks });
    if (aborted()) { await session.leave(); return; }
    sessionRef.current = session;
    setLocalVideo(session.localVideo);
    // onAgentJoined callback (agent already present) -> AGENT_JOINED -> connected + max-duration cap
  } catch {
    if (aborted()) return;
    await teardown();
    if (callId) void endCall(callId, "failed");
    dispatch({ type: "ERROR" });
  }
}, [state.callId, state.channelName]);
```
> Subagent note: reuse the **exact** `callbacks` object, `teardown`, `endCall`, `joinLiveKit`, `fetchVideoToken`, `callGenRef`, `sessionRef`, `setLocalVideo` that `onStartCall` uses (read `App.tsx`). The only differences from `onStartCall`: it POSTs `answerCall` instead of `startCall`, dispatches `ANSWER` not `CALL_STARTED`, and arms **no** ring timeout.

Render the screen in the screen-switch:
```tsx
if (state.screen === "incoming") return <IncomingCall onAnswer={onAnswer} />;
```

- [ ] **Step 5: Write the jsdom test** — `apps/kiosk/tests/app-incoming-answer.test.tsx` (mirror `app-video-join.test.tsx`'s mocking style). Mock `@/lib/portal-api` so `fetchIncomingCall` returns a call once, assert the "The front desk is calling" screen renders, click **Answer**, and assert `answerCall` + `fetchVideoToken` + `joinLiveKit` were called and the connected UI appears:

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const api = vi.hoisted(() => ({
  fetchKioskConfig: vi.fn(),
  fetchIncomingCall: vi.fn(),
  answerCall: vi.fn(),
  fetchVideoToken: vi.fn(),
  sendHeartbeat: vi.fn(),
  endCall: vi.fn(),
  startCall: vi.fn(),
}));
vi.mock("@/lib/portal-api", () => api);
vi.mock("@/lib/video/livekit", () => ({ joinLiveKit: vi.fn(async () => ({ localVideo: null, localAudioTrack: null, leave: vi.fn(), sendData: vi.fn() })) }));
vi.mock("@/lib/audio-unlock", () => ({ unlockAudioPlayback: vi.fn(), recoverAudioOnNextGesture: vi.fn() }));
vi.mock("@sentry/react", () => ({ captureException: vi.fn() }));

import App from "@/App";

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset?.());
  api.fetchKioskConfig.mockResolvedValue({ /* minimal KioskConfig the app needs */ });
  api.fetchIncomingCall.mockResolvedValue({ callId: "c1", channelName: "call_abc" });
  api.answerCall.mockResolvedValue({ channelName: "call_abc" });
  api.fetchVideoToken.mockResolvedValue({ provider: "livekit", url: "wss://x", channelName: "call_abc", token: "t" });
});

describe("kiosk answers an outbound call", () => {
  it("shows the incoming screen from the poll, then answers and connects", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText(/front desk is calling/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /answer/i }));
    await waitFor(() => expect(api.answerCall).toHaveBeenCalledWith("c1"));
    expect(api.fetchVideoToken).toHaveBeenCalledWith("call_abc", expect.any(Number));
  });
});
```
> Subagent note: read `apps/kiosk/tests/app-video-join.test.tsx` first and match its config mock shape + fake-timer usage exactly; the poll uses `setInterval`, so drive it with `vi.useFakeTimers()`/`vi.advanceTimersByTimeAsync` or an initial immediate `check()` (the code calls `check()` once on mount, so the first poll needs no timer advance).

- [ ] **Step 6: Run tests + build.**

Run: `pnpm --filter @lc/kiosk test && pnpm --filter @lc/kiosk build`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/kiosk/src/lib/portal-api.ts apps/kiosk/src/screens/IncomingCall.tsx apps/kiosk/src/App.tsx \
        apps/kiosk/src/lib/copy.ts apps/kiosk/tests/app-incoming-answer.test.tsx
git commit -m "feat(kiosk): incoming-call poll, Answer flow, and IncomingCall screen"
```

---

### Task 11: Kiosk terminal-drop → home + 10s tap lockout + "reconnecting" message

**Files:**
- Modify: `apps/kiosk/src/App.tsx` (terminal branch → `DROP` + `lockedUntil`; gate `onCall`)
- Modify: `apps/kiosk/src/screens/Home.tsx` (lockout message + disabled tap)
- Modify: `apps/kiosk/src/lib/copy.ts` (reconnecting-on-home string)
- Test: `apps/kiosk/tests/app-terminal-drop.test.tsx` (jsdom) — or extend `lib/connection.test.ts` for the pure part

- [ ] **Step 1: Write the failing test** — assert that after a terminal drop **from connected**, the app returns to Home with the tap disabled and a "reconnecting" message, and that the incoming poll still runs (a call-back still surfaces the Answer screen). Mirror the `app-*` jsdom style:

```tsx
// @vitest-environment jsdom
// ... same mocks as Task 10 ...
it("a terminal drop from a connected call returns home locked out, but a call-back still lands", async () => {
  // 1) drive a connected call, 2) fire the LiveKit onConnectionStateChange DISCONNECTED (not LEAVE),
  // 3) assert Home shows the reconnecting copy and the tap button is disabled/aria-disabled,
  // 4) make fetchIncomingCall return a call, advance the 3s poll, assert the Answer screen appears.
});
```
> This is integration-flavored; if wiring the LiveKit disconnect callback through the App test is too brittle, split: unit-test `isLockedOut` (done in Task 9) + a small pure `lockoutUntil(nowMs)` and cover the visual disabled-state with a focused Home test, then rely on Task 18 smoke for the end-to-end drop. Prefer the pure split over a brittle integration test.

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm --filter @lc/kiosk test -- terminal-drop`
Expected: FAIL.

- [ ] **Step 3: Implement.**

In `App.tsx`, add lockout state and change the terminal branch of `onConnectionStateChange`:
```tsx
import { RECONNECT_WINDOW_MS } from "@lc/shared";
import { isLockedOut } from "@/state/call-machine";
const [lockedUntil, setLockedUntil] = useState<number | null>(null);

// inside onConnectionStateChange, the "terminal" case:
const outcome = interpretConnectionState(current, reason);
if (outcome === "terminal") {
  setReconnecting(false);
  const id = callIdRef.current;
  const wasConnected = screenRef.current === "connected";
  void teardown();
  if (id) void endCall(id, "failed");
  if (wasConnected) {
    setLockedUntil(Date.now() + RECONNECT_WINDOW_MS); // Home shows "reconnecting" + disabled tap
    dispatch({ type: "DROP" });                        // -> home
  } else {
    dispatch({ type: "ERROR" });                       // pre-connect failure -> apology (unchanged)
  }
}
```

Gate the tap so a locked-out Home can't originate:
```tsx
const onStartCall = useCallback(async () => {
  if (isLockedOut(lockedUntil, Date.now())) return; // held during the reconnect window
  // ... existing body ...
}, [/* existing deps */, lockedUntil]);
```

Pass lockout info to Home:
```tsx
if (state.screen === "home") {
  return <Home onCall={onStartCall} lockedOut={isLockedOut(lockedUntil, Date.now())} />;
}
```
(To make the disabled state re-enable after 10s without a user event, add a tiny timer: when `lockedUntil` is set, `setTimeout(() => setLockedUntil(null), RECONNECT_WINDOW_MS)`.)

In `Home.tsx`, accept `lockedOut?: boolean`; when true, disable the tap (`aria-disabled`, ignore `onClick`) and show the reconnecting line:
```tsx
export function Home({ onCall, lockedOut = false }: { onCall: () => void; lockedOut?: boolean }) {
  // ... existing markup ...
  // on the tap wrapper: onClick={lockedOut ? undefined : onCall}, aria-disabled={lockedOut}
  // render {lockedOut && <p className="...">{copy.home.reconnecting}</p>}
}
```
Add `copy.home.reconnecting = "Reconnecting you to the front desk — one moment."`.

- [ ] **Step 4: Run tests + build.**

Run: `pnpm --filter @lc/kiosk test && pnpm --filter @lc/kiosk build`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/kiosk/src/App.tsx apps/kiosk/src/screens/Home.tsx apps/kiosk/src/lib/copy.ts \
        apps/kiosk/tests/app-terminal-drop.test.tsx
git commit -m "feat(kiosk): terminal-drop returns home with a 10s tap lockout + reconnecting message"
```

## Phase 4 — Agent UI

### Task 12: `startOutboundVideo` originate action on `CallSurfaceProvider` + host mount path

Adds the originate action to the surface and a registration seam so `VideoCallHost` mounts `<VideoCall>` in outbound mode — mirroring the existing `acceptVideo`/`registerAcceptVideo` pattern.

**Files:**
- Modify: `apps/portal/components/dashboard/call-surface-provider.tsx`
- Modify: `apps/portal/components/video-call/video-call-host.tsx`
- Test: `apps/portal/tests/components/call-surface-outbound.test.tsx` (jsdom) — light: the action POSTs and delegates

- [ ] **Step 1: Add the action + registration to the provider.** In `call-surface-provider.tsx`:

Extend the context value type with:
```ts
startOutboundVideo: (propertyId: string, propertyName: string) => Promise<{ ok: boolean; busy?: boolean }>;
registerStartOutbound: (fn: OutboundStarter | null) => void;
```
where `type OutboundStarter = (args: { callId: string; channelName: string; propertyId: string; propertyName: string }) => void;`

Implement (a `ref` holds the host's mounter, like `acceptVideoRef`):
```ts
const startOutboundRef = useRef<OutboundStarter | null>(null);
const registerStartOutbound = useCallback((fn: OutboundStarter | null) => { startOutboundRef.current = fn; }, []);

const startOutboundVideo = useCallback(async (propertyId: string, propertyName: string) => {
  const res = await fetch("/api/calls/start-outbound-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ propertyId }),
  }).catch(() => null);
  if (res && res.status === 409) return { ok: false, busy: true };
  if (!res || !res.ok) return { ok: false };
  const { callId, channelName } = (await res.json()) as { callId: string; channelName: string };
  startOutboundRef.current?.({ callId, channelName, propertyId, propertyName });
  return { ok: true };
}, []);
```
Add both to the memoized context value (and its dep array). Keep them **out of any relay that resets per callId** — they're stable app-level actions.

- [ ] **Step 2: Register + mount in the host.** In `video-call-host.tsx`:

The host already keeps an `active` state and mounts `<VideoCall .../>`. Register an outbound starter that sets `active` with an outbound marker + the pre-obtained channelName:
```tsx
const surface = useCallSurfaceOptional();
useEffect(() => {
  surface?.registerStartOutbound(({ callId, channelName, propertyId, propertyName }) => {
    setActive({ id: callId, channelName, propertyId, propertyName, outbound: true });
    surface?.publishActive("VIDEO", { callId, channel: "VIDEO", propertyId, propertyName, onHold: false, answeredAt: null, timeZone: null });
  });
  return () => surface?.registerStartOutbound(null);
}, [surface]);
```
Widen the host's `active` type to carry `channelName?: string` and `outbound?: boolean`, and pass them through:
```tsx
return active ? (
  <VideoCall
    callId={active.id}
    propertyName={active.propertyName}
    propertyId={active.propertyId}
    outbound={active.outbound ?? false}
    channelName={active.channelName ?? null}
    onClose={() => { setActive(null); surface?.publishActive("VIDEO", null); }}
    collapsed={surface?.tileMount != null}
  />
) : null;
```
(Inbound calls pass `outbound={false} channelName={null}` — `video-call.tsx` keeps its current answer-video behavior for that case in Task 13.)

- [ ] **Step 3: Write a light jsdom test** asserting `startOutboundVideo` POSTs `/api/calls/start-outbound-video` and, on `{callId, channelName}`, invokes the registered starter; and that a `409` returns `{ ok:false, busy:true }`. Mock `fetch`. Mirror an existing provider test if one exists; otherwise test the action in isolation by rendering a tiny consumer.

- [ ] **Step 4: Run tests + build.**

Run: `pnpm --filter @lc/portal test -- call-surface-outbound && pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal build`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/portal/components/dashboard/call-surface-provider.tsx apps/portal/components/video-call/video-call-host.tsx \
        apps/portal/tests/components/call-surface-outbound.test.tsx
git commit -m "feat(agent): startOutboundVideo action + host mount path for outbound calls"
```

---

### Task 13: `video-call.tsx` outbound `"calling"` phase (Calling…/Cancel/30s → NO_ANSWER)

The one genuinely new agent state. Adds a `phase` to the surface, branches the mount effect (outbound skips `answer-video` and uses the pre-obtained `channelName`), renders "Calling [hotel]…" until the kiosk joins, arms the 30s ring window, and offers Cancel.

**Files:**
- Modify: `apps/portal/components/video-call/video-call.tsx`
- Test: `apps/portal/tests/components/video-call-outbound.test.tsx` (jsdom)

- [ ] **Step 1: Write the failing test** — assert an outbound mount does **not** POST `answer-video`, GETs a token for the provided `channelName`, shows "Calling {propertyName}…", flips to connected when the remote video callback fires, and on the 30s timer (no remote) POSTs `end-video` and closes. Mock `@/lib/video/livekit-session` + `reliableFetch`/`fetch`. Mirror an existing `video-call` test if present.

```tsx
// @vitest-environment jsdom
// mock joinLiveKitCall to capture its callbacks so the test can fire onRemoteVideo manually
it("outbound: skips answer-video, shows Calling, connects on remote video", async () => {
  // render <VideoCall outbound channelName="call_abc" callId="c1" propertyName="Marlin" propertyId="p1" onClose={...} />
  // assert fetch was NOT called with /answer-video
  // assert token fetched for channel=call_abc
  // assert "Calling Marlin" visible
  // fire captured onRemoteVideo -> assert connected header/stage
});
it("outbound: 30s ring window with no answer finalizes and closes", async () => {
  vi.useFakeTimers();
  // render outbound, advance OUTBOUND_RING_WINDOW_MS, assert /end-video POSTed and onClose called
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm --filter @lc/portal test -- video-call-outbound`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `video-call.tsx`:

Add props + phase:
```tsx
// props: add  outbound?: boolean;  channelName?: string | null;
const [phase, setPhase] = useState<"calling" | "connected">(props.outbound ? "calling" : "connected");
```

Branch the `[callId]` connect effect. The inbound path (existing) POSTs `answer-video` → `{channelName}`. For outbound, skip that and use `props.channelName`:
```tsx
useEffect(() => {
  let cancelled = false;
  (async () => {
    let channel = props.channelName ?? null;
    if (!props.outbound) {
      const res = await reliableFetch(`/api/calls/${callId}/answer-video`, { method: "POST" });
      if (!res || !res.ok) { /* existing failure handling */ return; }
      channel = ((await res.json()) as { channelName: string }).channelName;
    }
    if (!channel || cancelled) return;
    const tok = await fetchToken(channel); // existing token GET
    const session = await joinLiveKitCall({
      url: tok.url, token: tok.token,
      onRemoteVideo: (t) => { if (!cancelled) { setPhase("connected"); /* existing attach */ } },
      onRemoteAudioTrack, onAudioBlocked, onGuestLeft, onData,
    });
    // existing localVideo.attach etc.
  })();
  return () => { cancelled = true; };
}, [callId]);
```

Arm the 30s outbound ring window (outbound only):
```tsx
import { OUTBOUND_RING_WINDOW_MS } from "@lc/shared";
useEffect(() => {
  if (!props.outbound || phase !== "calling") return;
  const id = setTimeout(() => { void handleEnd(); }, OUTBOUND_RING_WINDOW_MS); // handleEnd -> end-video (RINGING->NO_ANSWER, Task 8) -> onClose
  return () => clearTimeout(id);
}, [props.outbound, phase]);
```

Gate the guest-video-stage on phase — during `"calling"` render a placeholder instead of the (empty) remote stage:
```tsx
{phase === "calling" ? (
  <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[var(--color-call)] text-on-primary">
    <div className="h-14 w-14 animate-spin rounded-full border-2 border-on-primary/30 border-t-on-primary" aria-hidden />
    <p className="text-2xl font-medium">Calling {propertyName}…</p>
    <button type="button" onClick={() => void handleEnd()} className="rounded-full bg-primary px-8 py-3 text-lg text-on-primary">
      Cancel
    </button>
  </div>
) : (
  /* existing guest-video-stage JSX */
)}
```
The header can read `Calling · {propertyName}` while `phase === "calling"` and the existing `On video · {propertyName}` once connected. The control bar / playbook / chat / Connect / End render unchanged in both phases (they already tolerate a not-yet-attached remote). `handleEnd` is reused as-is (it POSTs `end-video`, which now finalizes RINGING→NO_ANSWER, then leaves + closes).

- [ ] **Step 4: Run tests + build.**

Run: `pnpm --filter @lc/portal test -- video-call && pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal build`
Expected: PASS. Run the full portal suite to confirm inbound `video-call` tests still pass (inbound `outbound=false` path is unchanged).

- [ ] **Step 5: Commit.**

```bash
git add apps/portal/components/video-call/video-call.tsx apps/portal/tests/components/video-call-outbound.test.tsx
git commit -m "feat(agent): outbound 'Calling…' phase in video-call with Cancel + 30s no-answer"
```

---

### Task 14: Property-card "Kiosk" button + liveness dot (agent + admin)

**Files:**
- Create: `apps/portal/components/dashboard/kiosk-call-button.tsx`
- Modify: `apps/portal/components/dashboard/property-card.tsx` (`PropertyCardData` gains `kioskOnline`; render the dot)
- Modify: `apps/portal/components/dashboard/pod-card-grid.tsx` (default slot renders Connect + Kiosk button)
- Modify: `apps/portal/app/(agent)/agent/page.tsx` + `apps/portal/app/(admin)/admin/page.tsx` (read `kiosks`, compute `kioskOnline`, add to card data)
- Test: `apps/portal/tests/components/kiosk-call-button.test.tsx` (jsdom)

- [ ] **Step 1: Write the failing test** — the button is duty-gated (like `ConnectButton`), greyed/disabled when `kioskOnline={false}` with an "Offline" hint, and calls `surface.startOutboundVideo(propertyId, propertyName)` on click when online + on-duty:

```tsx
// @vitest-environment jsdom
it("greys out with an Offline hint when the kiosk is offline", () => {
  // render <KioskCallButton propertyId="p1" propertyName="Marlin" kioskOnline={false} /> inside a mock surface+duty
  // assert the control is disabled and shows /offline/i
});
it("calls startOutboundVideo when online and on duty", () => {
  const startOutboundVideo = vi.fn().mockResolvedValue({ ok: true });
  // render online + on-duty, click, assert startOutboundVideo("p1","Marlin")
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm --filter @lc/portal test -- kiosk-call-button`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement `KioskCallButton`** (model on `connect-button.tsx`):

```tsx
"use client";
import { MonitorPlay } from "lucide-react";
import { useState } from "react";
import { useCallSurfaceOptional } from "@/components/dashboard/call-surface-provider";
import { useDutyOptional } from "@/components/dashboard/duty-context"; // match connect-button's duty hook import

export function KioskCallButton({ propertyId, propertyName, kioskOnline }:
  { propertyId: string; propertyName: string; kioskOnline: boolean }) {
  const surface = useCallSurfaceOptional();
  const duty = useDutyOptional();
  const [busy, setBusy] = useState(false);
  if (!surface) return null;
  const onDuty = duty?.onDuty ?? true;
  const disabled = !kioskOnline || !onDuty || busy;

  return (
    <button
      type="button"
      disabled={disabled}
      title={!kioskOnline ? "Kiosk offline" : !onDuty ? "Go on duty to call" : undefined}
      onClick={async () => {
        setBusy(true);
        const res = await surface.startOutboundVideo(propertyId, propertyName);
        setBusy(false);
        // busy -> a brief inline hint; keep minimal (a toast is a polish-pass nicety)
      }}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm text-accent-foreground disabled:opacity-50"
    >
      <MonitorPlay className="h-4 w-4" aria-hidden />
      {kioskOnline ? "Kiosk" : "Kiosk offline"}
    </button>
  );
}
```
(Match `connect-button.tsx`'s exact duty hook + class vocabulary — read it and mirror.)

- [ ] **Step 4: Plumb `kioskOnline` into the card.** In `property-card.tsx`, add `kioskOnline: boolean` to `PropertyCardData` and render a small liveness dot near the name using the existing dot pattern (`bg-live` online, `bg-border`/muted offline):
```tsx
<span className={cn("inline-block h-2 w-2 rounded-full", property.kioskOnline ? "bg-live" : "bg-muted-foreground/40")} title={property.kioskOnline ? "Kiosk online" : "Kiosk offline"} />
```

- [ ] **Step 5: Render Connect + Kiosk in the default slot.** In `pod-card-grid.tsx`, change the default `connectSlot` (currently `<ConnectButton propertyId={p.id} />`) to render both:
```tsx
connectSlot={connectFor ? connectFor(p.id) : (
  <div className="flex items-center gap-2">
    <ConnectButton propertyId={p.id} />
    <KioskCallButton propertyId={p.id} propertyName={p.name} kioskOnline={p.kioskOnline} />
  </div>
)}
```
This lights up on **both** agent (`<PodCardGrid>` default) and admin (`FleetBoard` → `PodCardGrid` default, no `connectFor`).

- [ ] **Step 6: Read `kiosks` in the pages + compute `kioskOnline`.** In `app/(agent)/agent/page.tsx` and `app/(admin)/admin/page.tsx`, after fetching the properties for the cards, fetch liveness and merge:
```ts
import { isKioskOnline } from "@/lib/kiosk/liveness";
const { data: kioskRows } = await supabase.from("kiosks").select("property_id, last_seen_at"); // RLS scopes to operator
const now = Date.now();
const kioskSeen = new Map((kioskRows ?? []).map((k) => [k.property_id, k.last_seen_at]));
// when building each card:  kioskOnline: isKioskOnline(kioskSeen.get(p.id) ?? null, now)
```
(Use the page's existing server Supabase client — the `kiosks_select_operator` RLS policy authorizes it.)

- [ ] **Step 7: Run tests + build.**

Run: `pnpm --filter @lc/portal test && pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal build && pnpm check:routes`
Expected: PASS. (Any existing `PropertyCardData` fixture in tests must add `kioskOnline` — update fixtures.)

- [ ] **Step 8: Commit.**

```bash
git add apps/portal/components/dashboard/kiosk-call-button.tsx apps/portal/components/dashboard/property-card.tsx \
        apps/portal/components/dashboard/pod-card-grid.tsx apps/portal/app/\(agent\)/agent/page.tsx \
        apps/portal/app/\(admin\)/admin/page.tsx apps/portal/tests/components/kiosk-call-button.test.tsx
git commit -m "feat(agent): property-card Kiosk call button + kiosk liveness dot (agent + admin)"
```

---

### Task 15: 10s "Call back" shortcut on the just-ended call

**Files:**
- Modify: `apps/portal/components/dashboard/call-surface-provider.tsx` (track `recentlyEnded`)
- Create: `apps/portal/components/dashboard/call-back-shortcut.tsx`
- Modify: `apps/portal/components/dashboard-workspace.tsx` (mount the shortcut)
- Test: `apps/portal/tests/components/call-back-shortcut.test.tsx` (jsdom)

- [ ] **Step 1: Write the failing test** — when a call ends (active → null with a known property), the shortcut appears for `RECONNECT_WINDOW_MS`, clicking it calls `startOutboundVideo`, and it disappears after the window:

```tsx
// @vitest-environment jsdom
it("shows Call back for 10s after a call ends and re-originates on click", () => {
  vi.useFakeTimers();
  // provide a surface whose recentlyEnded={{propertyId:'p1',propertyName:'Marlin'}}
  // assert "Call back" visible + click -> startOutboundVideo('p1','Marlin')
  // advance RECONNECT_WINDOW_MS -> assert gone
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm --filter @lc/portal test -- call-back-shortcut`
Expected: FAIL.

- [ ] **Step 3: Track `recentlyEnded` in the provider.** In `call-surface-provider.tsx`, when `active` transitions non-null → null, record the property for the reconnect window:
```ts
const [recentlyEnded, setRecentlyEnded] = useState<{ propertyId: string; propertyName: string } | null>(null);
const prevActiveRef = useRef<ActiveCallInfo | null>(null);
useEffect(() => {
  const prev = prevActiveRef.current;
  if (prev && !active && prev.propertyId) {
    setRecentlyEnded({ propertyId: prev.propertyId, propertyName: prev.propertyName });
    const id = setTimeout(() => setRecentlyEnded(null), RECONNECT_WINDOW_MS);
    return () => clearTimeout(id);
  }
  prevActiveRef.current = active;
}, [active]);
```
Expose `recentlyEnded` on the context value.

- [ ] **Step 4: Implement `CallBackShortcut`** — reads `recentlyEnded` + `startOutboundVideo`; agent-only (hide for admins/owners via a role prop or the duty context). A small fixed banner/pill:
```tsx
"use client";
export function CallBackShortcut() {
  const surface = useCallSurfaceOptional();
  const ended = surface?.recentlyEnded;
  if (!surface || !ended) return null;
  return (
    <button type="button" onClick={() => void surface.startOutboundVideo(ended.propertyId, ended.propertyName)}
      className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm text-accent-foreground shadow-lg">
      Call {ended.propertyName} back
    </button>
  );
}
```

- [ ] **Step 5: Mount** in `dashboard-workspace.tsx` (agent surface only — place beside the existing `VideoCallHost`; if admins share this workspace, gate on role so admins don't get it, or accept it for admins too since admins can Connect to any property. Default: render for agents; confirm the role available in the workspace props).

- [ ] **Step 6: Run tests + build.**

Run: `pnpm --filter @lc/portal test -- call-back-shortcut && pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal build`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/portal/components/dashboard/call-surface-provider.tsx apps/portal/components/dashboard/call-back-shortcut.tsx \
        apps/portal/components/dashboard-workspace.tsx apps/portal/tests/components/call-back-shortcut.test.tsx
git commit -m "feat(agent): 10s Call back shortcut on the just-ended call"
```

## Phase 5 — Liveness surfacing + direction labeling wiring

### Task 16: Admin status-page kiosk tile (mint / blaze)

**Files:**
- Modify: `apps/portal/app/(admin)/admin/status/page.tsx` (read `kiosks`, render a bespoke tile)
- (Reuses `StatusCard` + `isKioskOnline`; no new signal spec needed.)

- [ ] **Step 1: Read kiosk liveness in the status page.** In `status/page.tsx` (server component), after the existing `health_signals` read, add:
```ts
import { isKioskOnline } from "@/lib/kiosk/liveness";
const { data: kioskRows } = await supabase.from("kiosks").select("property_id, last_seen_at");
const now = Date.now();
const kiosks = kioskRows ?? [];
const onlineCount = kiosks.filter((k) => isKioskOnline(k.last_seen_at, now)).length;
const totalKiosks = kiosks.length;
const kioskStatus = totalKiosks === 0 ? "unknown" : onlineCount === totalKiosks ? "ok" : "warn";
```

- [ ] **Step 2: Render the tile** in the status grid alongside the other `<StatusCard>`s:
```tsx
<StatusCard
  label="Kiosks"
  status={kioskStatus}       // ok -> mint, warn -> blaze, unknown -> muted
  value={totalKiosks === 0 ? "None configured" : `${onlineCount}/${totalKiosks} online`}
/>
```
Red stays reserved for 911; `StatusCard` maps `ok:"bg-live"` (mint) / `warn:"bg-attention"` (blaze) / `unknown:"bg-muted-foreground/40"`. Color is paired with the count label.

- [ ] **Step 3: Build.**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal build && pnpm check:routes`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/portal/app/\(admin\)/admin/status/page.tsx
git commit -m "feat(admin): kiosk online/offline tile on the status page"
```

---

### Task 17: Thread `direction` into call views + apply direction-aware labels/counts

Wires the Task-4 pure functions into the real surfaces so an OUTBOUND NO_ANSWER shows "No answer" (neutral), not "Missed" (blaze), and doesn't inflate missed stats or appear under the "Missed" filter.

**Files:**
- Modify: `apps/portal/components/call/call-detail-body.tsx` + `call-row.tsx` (thread `direction` through `CallDetail`/`CallRowData`, pass to `callPill`)
- Modify: `apps/portal/components/owner/status-pill.tsx` (accept + forward `direction`)
- Modify: `apps/portal/components/dashboard/recent-call-row.tsx` (import the pure `outcomeDotClass(state, direction)`; add `direction` to its row query)
- Modify: `apps/portal/lib/calls/filters.ts` + the owner/admin call-list pages (`?outcome=missed` excludes OUTBOUND)
- Modify: the call-list queries to `select` `direction` (owner calls, admin calls, property detail, agent/admin recent, dashboards)
- Test: extend the existing call-row/detail tests with an OUTBOUND NO_ANSWER case

- [ ] **Step 1: Write/extend failing tests.** For `call-detail-body`/`call-row`, render a `CallDetail` with `direction: "OUTBOUND", state: "NO_ANSWER"` and assert the pill reads "No answer" and lacks the `attention` class. For `recent-call-row`, assert the dot uses the neutral class for OUTBOUND NO_ANSWER.

- [ ] **Step 2: Run tests to verify they fail.**

Run: `pnpm --filter @lc/portal test -- "call-row|call-detail|recent-call"`
Expected: FAIL — `CallDetail`/`CallRowData` have no `direction`; components ignore it.

- [ ] **Step 3: Implement.**
  - Add `direction: CallDirection` to `CallDetail` (call-detail-body.tsx) and `CallRowData` (call-row.tsx); default missing values to `"INBOUND"` at the mapping boundary so partial callers stay safe.
  - In `call-row.tsx` / `owner/status-pill.tsx`, call `callPill(detail.state, detail.direction)` (was one-arg).
  - In `call-detail-body.tsx`, call `callStateLabel(state, direction)` where it labels the state.
  - In `recent-call-row.tsx`, replace the inline `outcomeDotClass` with the imported pure one and pass `row.direction`.
  - Add `direction` to every `calls` `select(...)` that feeds these rows: owner calls list/detail, owner property detail recent, admin `/admin/calls`, admin dashboard recent, agent dashboard recent, and the dashboard stat queries (`countByOutcome`/`hourlyVolume` inputs).
  - **Missed filter exclusion:** in the owner + admin call-list pages, when the active outcome is `"missed"`, add `.eq("direction", "INBOUND")` to the query so outbound no-answers never appear under "Missed". (Leave `lib/calls/filters.ts` `OUTCOME_STATES` as-is; the direction guard is a query-level `.eq`, applied only for the missed bucket.)

- [ ] **Step 4: Run the full suite + build.**

Run: `pnpm --filter @lc/portal test && pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal build && pnpm check:routes`
Expected: PASS. All pre-existing call-view tests (inbound) stay green because the default direction is `"INBOUND"`.

- [ ] **Step 5: Commit.**

```bash
git add apps/portal/components/call/call-detail-body.tsx apps/portal/components/call/call-row.tsx \
        apps/portal/components/owner/status-pill.tsx apps/portal/components/dashboard/recent-call-row.tsx \
        apps/portal/lib/calls/filters.ts apps/portal/app/\(owner\)/ apps/portal/app/\(admin\)/ apps/portal/app/\(agent\)/
# (add the specific modified page files by path — do NOT `git add -A`)
git commit -m "feat(calls): thread direction into call views; outbound NO_ANSWER not 'Missed'"
```

---

## Phase 6 — Smoke

### Task 18: Staging + real-iPad smoke walk

The LiveKit reverse-connect + kiosk poll can only be verified running. Deploy the branch to staging (Coolify auto-builds on push), apply migrations 0022/0023 to the **staging** Supabase (`cgtvqjxhbojztzumshca`) via MCP, and walk the flow on a real iPad kiosk (Mac Chrome is a pessimistic proxy).

- [ ] **Step 1: Apply migrations to staging.** Via Supabase MCP `apply_migration` on the staging project: 0022 then 0023. Regenerate types were already committed against local; confirm `gen:types:check` is green in CI.

- [ ] **Step 2: Push the branch; confirm Coolify staging build is green** (`staging.` / `staging-kiosk.lobby-connect.com`). Confirm the box has `KIOSK_CONFIG_SECRET`, LiveKit env, etc. (already present from prior phases).

- [ ] **Step 3: Happy path.** Agent on duty → property card shows a **mint** kiosk dot → click **Kiosk** → agent sees "Calling [hotel]…" → the iPad (idle on Home) flips to "The front desk is calling — Answer" within ~3s → tap **Answer** → both connected → verify **captions**, **in-call chat**, and **RustDesk Connect** all work → hang up → **agent presence returns to AVAILABLE** (check the dashboard duty state, not stuck ON_CALL).

- [ ] **Step 4: Glare.** While an outbound call is RINGING, tap the kiosk Home → it should surface **Answer** (graceful), not an error. Start a second outbound to the same property from another admin → **409 "busy."**

- [ ] **Step 5: 30s no-answer.** Click **Kiosk**, leave the iPad idle → after 30s the agent sees "No answer" and the row finalizes `NO_ANSWER`; confirm in owner call history it renders **"No answer" (neutral), not "Missed" (blaze)**, and does not appear under the Missed filter.

- [ ] **Step 6: Terminal-drop lockout.** Mid-connected-call, kill the kiosk network (or force a terminal disconnect) → the iPad returns Home showing "Reconnecting you to the front desk — one moment," tap disabled ~10s; within that window fire an agent **Call back** → the iPad flips straight to Answer. After 10s, the tap re-enables.

- [ ] **Step 7: Liveness offline.** Power off / sleep the iPad → within ~90s the property-card dot goes **muted** and the Kiosk button greys with "Offline"; the admin status page **Kiosks** tile flips to **blaze** with a reduced count.

- [ ] **Step 8: Presence-bug regression.** Run a normal **inbound** guest call → answer → hang up → confirm the agent is no longer stuck ON_CALL (the `task_71d65b0a` fix).

- [ ] **Step 9: Record results** in a handoff (`docs/handoffs/2026-07-15-outbound-video-calls-*.md`) and, once green, merge `--no-ff` to `main` (Coolify auto-deploys prod `lc-portal-prod`/`lc-kiosk-prod`; apply 0022/0023 to **prod** Supabase via MCP + enter nothing else — the blue-green standby stays frozen). Re-run the prod smoke on the real pilot iPad.

---

## Self-review (checked against the spec)

**Spec coverage — every §/requirement maps to a task:**
- §2 outbound video call → Tasks 5,12,13. Two entry points (card button + 10s call-back) → Tasks 14,15. Kiosk Answer screen via poll → Tasks 6,9,10. Abrupt-disconnect lockout → Task 11. `calls.direction` → Task 1. Kiosk liveness (write + card dot + status tile) → Tasks 1,6,14,16. Presence fix → Task 8.
- §3 reuse-and-reverse: 3 routes → Tasks 5,6,7; reused surfaces unchanged (captions/chat/RustDesk verified in Task 18).
- §4 UX: Calling… state + Cancel → Task 13; Kiosk button greys offline → Task 14; Answer screen → Task 10; lockout → Task 11; 30s ring window → Tasks 2,13.
- §5 data model: 0022/0023 → Task 1.
- §6 glare: one-active-call index 409 → Task 5 (insert) + smoke Task 18; graceful degrade → Tasks 10,18.
- §7 liveness: writes → Tasks 6 (poll+heartbeat); read helper → Task 3; card dot → Task 14; status tile → Task 16.
- §8 presence → Task 8 (end-video + reaper).
- §9 attribution/labeling → Tasks 1,4,17 (handled_by + direction + non-missed labeling).
- §10 edge cases → covered across Tasks 5–13; smoke Task 18.
- §11 testing → TDD in Tasks 2,3,4,7,8,9 (pure) + jsdom in 10,12,13,14,15; smoke Task 18.
- §12 sequencing / §13 file-touch map → the phase/task order and the File-structure section match.
- Decision log D1–D11 → all honored; the 6 mapping-time refinements (returns-no-token, generalized end-video, incoming-video exclusion, distinct kiosk claim, overlay-only outbound, fresh-only liveness) are documented at the top with rationale.

**Placeholder scan:** no TBD/"add error handling"/"similar to Task N" — each modification shows the concrete code or a precise anchor + snippet. Where a subagent must match an existing import/signature exactly (e.g. `broadcastCallsChanged`, the duty hook, the config mock shape), that's called out explicitly with the file to read.

**Type consistency:** `CallDirection` ("INBOUND"|"OUTBOUND") defined once (Task 1), used everywhere. `callStateLabel(state, direction?)` / `callPill(state, direction?)` / `outcomeDotClass(state, direction?)` signatures consistent across Tasks 4 and 17. Reducer names (`INCOMING_CALL`/`ANSWER`/`DROP`/`isLockedOut`) consistent between Task 9 (def) and Tasks 10/11 (use). `startOutboundVideo`/`registerStartOutbound`/`OutboundStarter` consistent across Tasks 12,14,15. `claimOutboundByKiosk`/`resetPresenceAfterCall` consistent across Tasks 7,8. `isKioskOnline` consistent across Tasks 3,14,16. `channelName`/`outbound` props on `VideoCall` consistent across Tasks 12,13.




