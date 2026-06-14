# Phase 4 — Encode invariants, add indexes, stand up CI — Design

**Status:** Design (awaiting approval → plan)
**Date:** 2026-06-14
**Source:** Final tranche of the 2026-06-10 architecture audit (`docs/audits/2026-06-10-architecture-audit.md` → "Phase 4 — Encode the scale invariants where they belong"; triage `…-triage.md`).
**Predecessors:** Phase 2 (seam extractions, PR #18), Phase 3 (perf/parallelization, `37ff689`) — both merged + prod-smoke-confirmed.

---

## 1. Why this phase

Phases 1–3 fixed the behavior bugs, extracted the security/tenancy seams, and engineered the polling cost. What remains is the **invariant layer**: constants and types that have one correct value *somewhere* but are re-declared or hand-synced elsewhere; two missing DB indexes; some dead code; and the absence of any automated gate to keep all of it from regressing. The codebase is about to grow a team, so this phase also stands up **CI** — the thing that makes every other fix in this phase *stay* fixed.

Everything here is behavior-preserving **except** three small, tested correctness fixes: S3 (presence staleness bound), S8 (kiosk one-active-call DB guard), and S2 (dial fan-out cap).

## 2. Scope

**In scope (verified still-open against `main`, 2026-06-14):**

| Group | IDs | One-line |
|---|---|---|
| Shared constants | M7, A8 | All timing invariants → `@lc/shared/protocol.ts` with a static ordering assertion |
| Type/build invariants | M3, M2, M8 | Single `CallState`; remove 22 `as never` casts; type `AuditEvent.details` |
| Dedup freebies | D10, D9 | Audit-action constants; shared playbook signed-URL helper |
| Auth seam | M4 | Repoint password reset at `/auth/confirm`; delete `/auth/callback` |
| Dead code | A7 | Delete the unused browser Supabase client |
| Correctness | S3, S8 | Time-bound ON_CALL inference; DB-level one-active-call guard |
| Scale (opted-in) | S2, S7, S11 | Dial cap+warn; batch reaper writes; audit-action index |
| Enforcement | M6 + CI | Generated-base-types + drift check; GitHub Actions CI |

**Out of scope / deliberately left:**

- **A4** (911 choreography still partly inline) — Phase 2 kept the 911 path **byte-identical** on purpose (life-safety). The conference/dispatch/guard helpers are already extracted; the remaining inline orchestration stays as-is.
- **A2** (presence asymmetric writers) — the client-merge half is already done (Stage-2 `LineStatusContext`); the server-side harm is the stale read, which **S3 fixes**. We are **not** adding ON_CALL writes to the finalization routes (delicate idempotent path; not worth the risk once staleness is bounded).
- DEFER-V2 items **not** named in the Phase 4 list (S4/S6/P3 — true scale work) and all ACCEPT-RISK items except S2.

## 3. Locked decisions (from brainstorm)

1. **Full scope** — all BUG items + the cheap orphans (M8/D9/D10) + the three deferred items the audit slotted into Phase 4 (S2/S7/S11).
2. **CI = GitHub Actions** (not Vercel-build-only), implemented as a thin workflow that calls local npm scripts, so every check is runnable locally *and* gated on every PR before merge. Drift check uses a throwaway **local** Postgres in CI — no prod coupling, no prod secrets.
3. **M6 = generated base + curated overlay** (Option 1) — structure comes from `supabase gen types`; the curated unions are layered back on via a typed override. The only fully-reliable drift detection, and it *reduces* per-migration work going forward.

## 4. Workstreams

Each workstream is independent and lands as its own commit(s). TDD where there's logic; pure mechanical changes are gated by typecheck + the existing suite + the new CI checks.

### A. `packages/shared/src/protocol.ts` (M7, A8)

New module — the single home for cross-app timing invariants. Exported through the existing `export *` barrel in `index.ts`.

```ts
// Ring window (locked decision 1) — guest-dial timeout, mirrored in webhook + kiosk.
export const RING_WINDOW_SECONDS = 120;
export const RING_WINDOW_MS = RING_WINDOW_SECONDS * 1000;

// Presence heartbeat staleness (effective-presence + cron sweep).
export const PRESENCE_STALE_AFTER_MS = 90_000;

// Reaper thresholds (must each exceed the ring window).
export const REAP_RINGING_AFTER_MS = 10 * 60_000;
export const REAP_IN_PROGRESS_AFTER_MS = 30 * 60_000;

// Cron sweep cadence (pilot = daily; Pro-tier flip documented in build-quirks).
export const CRON_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Module-load invariant guard: the reaper must outlast the ring window, or a
// still-ringing call could be reaped mid-window. Throws at import if violated.
if (REAP_RINGING_AFTER_MS <= RING_WINDOW_MS) {
  throw new Error("protocol: REAP_RINGING_AFTER_MS must exceed RING_WINDOW_MS");
}
```

**Consumers updated to import from `@lc/shared`:** `app/api/twilio/voice/incoming/route.ts` (was `RING_TIMEOUT_SECONDS`), `apps/kiosk/src/App.tsx` (was `RING_TIMEOUT_MS`), `lib/voice/presence.ts` (was `STALE_AFTER_MS`), `lib/status/signals.ts` (was `CRON_SWEEP_INTERVAL_MS`), `lib/calls/reaper.ts` (re-export or import its two thresholds). Old local declarations deleted. **Values are unchanged** — pure relocation.

*Tests:* `protocol.test.ts` asserts the ordering invariant (`REAP_RINGING_AFTER_MS > RING_WINDOW_MS`) and the documented numeric values — TypeScript can't compare number *values* at the type level, so the guard is a module-load throw plus this unit test rather than a compile-time assertion.

### B. Type & build invariants (M3, M2, M8)

**M3 — single `CallState`.** `CallState` already lives in `supabase-types.ts` (`@lc/shared`). Delete the duplicate union in `lib/voice/result.ts`; re-export it: `export type { CallState } from "@lc/shared";`. The 2 `as CallState` casts (`status/route.ts:42`, `dial-result/route.ts:67`) become unnecessary once the column type and the function parameter share one source — remove them.

**M2 — remove `as never` route casts (22 found, 0 annotated).**
- Static-literal hrefs (e.g. `"/admin/properties"`) → remove the cast; they satisfy `Route`.
- Dynamic/interpolated hrefs (e.g. `` `/owner/properties/${id}` ``, `buildHref(...)`) → use `as Route` (imported from `next`), the *sanctioned* typed-routes escape — **never** `as never`.
- Generic nav components (`nav-item.tsx`, `owner-nav.tsx`) → type the `href` prop as `Route` so callers pass typed values and the inner cast disappears.
- Any genuinely not-yet-built route → keep a cast **annotated `// FORWARD-REF: <reason>`** (none expected; all routes currently exist).
- **Guard:** `scripts/check-routes.mjs` fails if any `as never` appears under `app/` or `components/` without an adjacent `// FORWARD-REF:`. Wired into CI + a `pnpm check:routes` script.

**M8 — type `AuditEvent.details`.** Replace `details?: Json` in `lib/auth/audit.ts` with `details?: AuditDetails` where `AuditDetails = { [k: string]: Json }` (a JSON **object**, which every real call site already passes). Removes the 4 divergent casts (`as Json`, `as unknown as Json`, `as never`). Where a builder currently produces a typed object, it now flows without a cast.

### C. Audit & storage dedup (D10, D9)

**D10 — `lib/audit/actions.ts`.** Export the audit-action vocabulary as `const AUDIT_ACTIONS = { USER_CREATED: "user.created", … } as const` plus a derived `KNOWN_ACTIONS` array. The `/admin/audit` dropdown imports `KNOWN_ACTIONS` (no more hand-synced literal list). Call sites import the constants instead of bare strings. *(Pairs naturally with the `lib/audit/` module that Phase 2's `diff.ts` already established.)*

**D9 — `lib/storage/playbook.ts`.** Export `createPlaybookSignedUrl(admin, path, ttl?)` (the `createSignedUrl("playbooks", …)` block). Both `app/api/calls/[id]/playbook/route.ts` (agent) and `app/api/owner/properties/[id]/playbook/route.ts` (owner) call it. *Neutral location* — not `lib/owner/` — so the agent route doesn't import from an owner module. `SIGNED_URL_TTL` centralized here.

*Tests:* `lib/storage/playbook.ts` gets a small unit test (mocked storage client). The action-constants module is exercised by existing route/action tests once they import the constants.

### D. Auth seam (M4)

`app/(auth)/forgot-password/actions.ts:23` — change `redirectTo` from `…/auth/callback?next=/auth/update-password` to `…/auth/confirm?type=recovery&next=/auth/update-password` (the shape `/auth/confirm` already handles via `verifyOtp`, matching `docs/setup/2026-06-04-auth-email-templates.md`). Then **delete** `app/auth/callback/route.ts` — the documented session-dropping handler; only that one action and a comment in `confirm/route.ts` reference it. Update the comment. This path is dormant (no SMTP) but reachable via Supabase's limited built-in email, so it's a latent correctness fix, not cosmetic.

### E. Dead code (A7)

Delete `apps/portal/lib/supabase/client.ts` — 0 importers; it imports `@/lib/env` (server-only validation) at module scope, so it would crash in any browser bundle that imported it. A landmine, not a feature.

### F. Correctness fixes (S3, S8)

**S3 — bound ON_CALL inference.** In `app/api/presence/route.ts`, the query that infers ON_CALL from a live IN_PROGRESS VIDEO call currently reads **any** such row. Add `.gte("answered_at", <now − REAP_IN_PROGRESS_AFTER_MS>)` (constant from `protocol.ts`), mirroring the time-bound already on `incoming-video/route.ts`. Effect: a leaked IN_PROGRESS row older than 30 min no longer pins an agent "On a call." *Tests:* `tests/app/presence.test.ts` — a stale IN_PROGRESS row does **not** force ON_CALL; a fresh one does.

**S8 — DB-level one-active-call guard.** Migration **0016**:
```sql
create unique index calls_one_active_video_per_property
  on calls (property_id)
  where channel = 'VIDEO' and state in ('RINGING','IN_PROGRESS');
```
`app/api/kiosk/call-started/route.ts` keeps the check-then-insert as a friendly fast-path, and additionally maps a `23505` insert error → **409** (same body as the existing "call in progress" branch). The index is the real guard; the race window closes. *Tests:* `tests/app/kiosk/call-started.test.ts` — a simulated `23505` returns 409, not 500. *(Prod-apply note: confirm no pre-existing active-VIDEO duplicates before applying, or the index build fails — the reaper should already prevent any.)*

### G. Scale items opted-in (S2, S7, S11)

**S2 — cap the dial fan-out.** `planDial()` (`lib/voice/plan-dial.ts`, pure) caps the deduped target list at **10** (Twilio `<Dial>` rejects 11+ parallel `<Client>` nouns — a silent whole-call failure). Priority order is already deterministic (primary agent first, then accepting admins). Its return type changes from `DialTarget[]` to **`{ targets: DialTarget[]; droppedCount: number }`** (pure + testable; one caller + its tests update accordingly); the **caller** (`incoming/route.ts`) emits `Sentry.captureMessage("dial fan-out capped", …)` when `droppedCount > 0`. *Tests:* `lib/voice/plan-dial.test.ts` — 12 candidates → 10 targets + `droppedCount === 2`, priority preserved; ≤10 → `droppedCount === 0`.

**S7 — batch reaper writes.** `reap-stale-calls/route.ts` and `mark-stale-offline/route.ts` currently fetch-all then update **per row** in a loop (+ per-operator heartbeat loops). Replace with a single bulk UPDATE (`.in("id", ids)` / a WHERE-clause update) per state class. Pure row-selection logic stays in `lib/calls/reaper.ts`; only the write shape changes. Behavior-identical (same rows transition); fewer round-trips. *Tests:* reaper unit tests assert the batched id-set matches the prior per-row selection.

**S11 — audit-action index.** Migration **0017**:
```sql
create index audit_logs_operator_action_created_idx
  on audit_logs (operator_id, action, created_at desc);
```
Matches the `/admin/audit` filter query (operator-scoped, optional action filter, reverse-chron). Additive; no code change.

### H. M6 — generated-base types + CI

**M6 type architecture (Option 1).**
- `gen:types` script → `supabase gen types typescript --local > packages/shared/src/database.generated.ts`. This is the machine-generated **structural base** (regenerated, never hand-edited).
- `supabase-types.ts` becomes the **curated overlay**: it imports the generated `Database`, applies a typed deep-override that re-narrows the CHECK-constrained columns to the curated unions (`calls.state → CallState`, `calls.channel → CallChannel`, `profiles.role → Role`, `profiles.status → ProfileStatus`, `audit_logs.actor_type → ActorType`, incident `severity/kind/status`, `properties.kiosk_cta_style → KioskCtaStyle`), then re-exports `Database`, `Json`, `Tables*`, the named Row aliases, and the unions. The deep-override uses `type-fest`'s `MergeDeep` (Supabase's own documented pattern) or a small local equivalent. **All existing `@lc/shared` importers are unaffected** — same exported names, same (or more precise) types.
- `gen:types:check` script → regenerates to a temp file, `diff`s against the committed `database.generated.ts`, exits non-zero with "run `pnpm gen:types` and commit" on drift. **Only the generated base is diffed**; the overlay never causes false failures.

**CI — `.github/workflows/ci.yml`.** On `push` + `pull_request`:
1. checkout → setup pnpm + Node (match local) → `pnpm install --frozen-lockfile`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
5. start a local Postgres with migrations applied (`supabase start`, db-only via `-x` to skip unneeded services for speed) → `pnpm gen:types:check`
6. `pnpm check:routes` (M2 cast guard)

No prod secrets; the DB is a throwaway container. ~1–2 min added; $0 on the free tier.

## 5. Migrations

| # | File | Change | Safe? |
|---|---|---|---|
| 0016 | `0016_calls_one_active_video.sql` | Partial unique index on active VIDEO calls per property (S8) | Additive; fails only on pre-existing dup (none expected) |
| 0017 | `0017_audit_action_index.sql` | Composite index on `audit_logs(operator_id, action, created_at desc)` (S11) | Additive, zero-risk |

Committed before applying. **Applied to prod via Supabase MCP after merge** (established pattern), then prod smoke.

## 6. Execution approach

**Subagent-driven development** (the established pattern for every recent phase): the implementation plan decomposes into independent tasks; each task gets a focused spec + a per-task quality/code review by a subagent; an opus whole-branch review runs before merge. TDD for all logic (S2/S3/S7/M8/D9/protocol assertion); mechanical changes (M2/M3/A7/M4/D10) gated by typecheck + full suite + the new CI checks.

**Ordering (rough):** A (protocol.ts) and the M6 type base first (they unblock imports), then B/C/D/E mechanical, then F/G correctness+scale, then H wires CI last so it runs against the finished tree. Migrations 0016/0017 with their code.

## 7. Verification

- `pnpm lint && pnpm typecheck && pnpm test` green (target: current ~414 + new tests).
- New CI workflow green on the PR (all six steps).
- `pnpm gen:types:check` clean against committed generated types.
- `pnpm check:routes` reports zero un-annotated `as never`.
- Post-merge: apply 0016/0017 to prod; prod smoke — one video call (kiosk→agent, confirms S8 index doesn't break the happy path) + confirm `/admin/audit` filter still works (S11) + a no-answer audio call (confirms dial path + S2 cap untouched at n<10).

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| M6 overlay refactor touches a load-bearing file; a wrong override silently widens a type | Full typecheck + suite gate; override list reviewed column-by-column; generated base diffed in CI |
| 0016 index build fails on a pre-existing active-VIDEO duplicate | Pre-apply check query; reaper already prevents leaks; fix data then apply |
| `supabase start` flakiness/slowness in CI | db-only start (`-x`); pin CLI version; step has its own retry/timeout |
| Removing `as never` surfaces a genuinely-broken dynamic href | That's the point — fix the href or use `as Route`; typecheck catches it before merge |
| S7 bulk update changes which rows transition | Unit tests assert the batched id-set equals the prior per-row selection; behavior-identical |

## 9. References

- `docs/audits/2026-06-10-architecture-audit.md` §"Phase 4" + triage
- `CLAUDE.md` — Phase 2/3 entries, locked decisions, key patterns
- `memory/build-quirks.md` — Vercel Hobby cron cadence (A8/CRON_SWEEP_INTERVAL_MS context)
- Supabase docs — "Generating types" + `MergeDeep` override pattern (M6)
- `docs/setup/2026-06-04-auth-email-templates.md` — `/auth/confirm` recovery shape (M4)
