# Phase 3 — Per-request Caching & Parallelization

**Created:** 2026-06-12 (session 19). **Status:** approved (user "go for it") — ready for `writing-plans`.
**Context:** 2026-06-10 architecture-audit remediation (`TASKS.md` Phase 3). Phases 0/1/2 + the
notes-durability interlude are shipped to `main`; Phase 2's prod smoke is confirmed. This is the
**performance** phase: cut redundant round-trips on every protected render + the voice critical path,
and fix the one count that silently truncates at scale.
**Audit cross-refs:** P3-1 → P1 (+ identity-half of P8); P3-2 → P4/S5; P3-3 → P5; P3-4 → P8;
P3-5 → P2/S9; P3-6 → P6 (+ P7/S4/S10). P1/P4/P5/P8/P6 are bucketed **BUG**; P2/S9 and P7/S10 are
**ACCEPT-RISK** and S4 is **DEFER-V2** — they land here because the user chose "full Phase 3" over the
pilot-relevant slice. Validated against `CLAUDE.md` locked decisions + the 2026-06-10 triage: none is
an intended feature; the only locked decision touched is #4 (polling, not subscriptions), which is
**preserved** — keyset stays poll-compatible.

---

## 1. Scope

Six changes, one phase, **zero migrations**. The phase is **behavior-identical except one deliberate
UX change** (owner "Calls" infinite-accumulate → cursor pages, §6). It is **pilot-proportional**: the
fixes are correct at any scale, but we do not add the v2-scale machinery (keyset index, grouped-count
RPC) that only pays off at many-property volume.

**In scope:**

- **P3-1 — `lib/auth/session.ts` (new).** A React `cache()`-wrapped `getSessionProfile()` does one
  `auth.getUser()` + one `profiles` select per request. `requireRole` calls it and keeps its redirect
  logic. The select is widened to include `full_name` + `email` so layouts/pages drop their *second*
  profiles read for the display name. Per protected render: **3→2 `getUser`, ~3→1 `profiles`**.
- **P3-2 — restage `app/api/twilio/voice/incoming/route.ts`.** The 8 serial awaits before TwiML
  collapse to **property-gate → detached heartbeat → `Promise.all`(3 independent branches) → insert**
  = 4 hops. Same `planDial` inputs, same TwiML, same insert. **Voice critical path** → its own PR +
  opus review + prod voice smoke.
- **P3-3 — parallelize `app/(owner)/owner/page.tsx`.** Stage 1 `properties` → stage 2
  `Promise.all([agent chain, per-property call counts+last-call, open-incidents])`. ~5→3 RTT.
- **P3-4 — dedup the agent shell.** The agent **layout** and **page** each fetch the same
  profile-name + assignments + covered properties. `cache()`-memoize them (`getSessionProfile` for the
  name, a new `getAgentCoverage()` for assignments+properties) so they run once per request, not twice.
- **P3-5 — `unstable_cache` the Sentry probe.** Wrap `getRecentErrorCount()` (60s revalidate) so
  `/admin/status`'s 20s refresh stops hitting the Sentry API every tick (4,320/day/tab → ~1/min).
- **P3-6 — counts + keyset.**
  - *Counts (P6, the BUG):* the admin overview computes "calls today" + open-incidents by **shipping
    every 48h row** and counting in JS — silently wrong past PostgREST's 1000-row cap. Switch the
    calls counts to **count queries** (`{ count: "exact", head: true }`; per-property tz-aware
    today-window) and the admin open-incidents stat to `head: true`. (Owner home's per-property open
    set stays a small bounded row-fetch — it isn't a 1000-cap risk; the 48h *calls* haul is.)
  - *Keyset (P7/S4/S10):* owner "Calls" moves from a growing `?limit` window to **stateless cursor
    pages** (`(created_at, id)` keyset, 50/page, Older/Newest). Each AutoRefresh then pulls 50 rows,
    not the whole accumulated window.

**Out of scope / non-goals:**

- **No DB / RLS / migration changes.** No keyset index — the existing `created_at` index suffices at
  pilot scale; a covering `(property_id, created_at desc, id desc)` index is a v2 nicety, not needed
  for correctness. No grouped-count RPC — per-property count queries run in `Promise.all`; the RPC
  collapse is the v2 path for many-property scale.
- **No subscriptions.** Locked decision #4 (20s polling + refetch-on-focus) is preserved. Keyset is
  designed to be poll-friendly (each refresh re-reads the current page only).
- **No logic changes on the voice path.** P3-2 changes *await scheduling* + detaches the (already
  best-effort) heartbeat. Routing, `planDial`, idempotency, the insert, the `catch → apology`
  degradation, and the per-query `SUPABASE_TIMEOUT_MS` bound are byte-identical. This route does **not**
  touch 911.
- **No `requireApiActor` change.** The API-route actor (Phase 2, `lib/auth/api-actor.ts`) resolves
  once per API request — no intra-request duplication to dedup. `cache()` is RSC-render-scoped and is
  not applied there. P3-1 is page/layout-render only.
- **No Phase 4 work.** Presence asymmetric-writer (A2), `CallState` unification (M3), `typedRoutes`
  cast removal (M2), the kiosk-race index (S8), and the scale-invariant items stay in Phase 4.

**Decisions locked (session 19):**

1. **Two PRs.** **PR-A "safe batch"** = P3-1, P3-3, P3-4, P3-5, P3-6 (app-internal, unit-testable +
   locally verifiable, merges on green). **PR-B "voice"** = P3-2 alone (opus implementer+review, its
   own prod voice smoke, separate deploy). P3-2 is the only change that can break a real guest call and
   the only one verified by a live prod phone call; splitting lets PR-A ship without waiting on it.
2. **`cache()` is RSC-only.** It dedupes layout+page within one render; it cannot reach the middleware
   runtime, so middleware keeps its own `getUser` (3→2, not 3→1). Accepted.
3. **`requireRole` returns a richer profile** (`+ full_name, email`). Additive — backward-compatible
   with every existing caller; callers that did a second name read drop it.
4. **Counts: admin overview = pure count queries; owner home = parallelize + per-property
   count(today) + latest(`limit 1`).** Owner home needs the last-call *value*, so it keeps a tiny
   ordered fetch rather than a bounded row-haul — strictly correct at any scale, matching admin's
   pattern, not a `limit`-capped approximation.
5. **Keyset = stateless cursor pages, not client-accumulation.** Pages fit the pure-RSC + AutoRefresh
   model; client-side accumulation would fight `router.refresh()`. The accumulate→pages shift is the
   one user-visible change in the phase (§6).
6. **P3-5 = `unstable_cache` (60s).** React `cache()` only dedupes within a render; the 20s refreshes
   are separate requests, so the Sentry call needs the time-based data cache.
7. **P3-2 minimizes the voice diff.** Restage only; the two branch resolvers stay local async helpers
   in the route (no relocation to `lib/`) so the riskiest file's diff is as small as possible.

---

## 2. Approach

Each change is independently behavior-preserving (except the keyset UX), so there is no two-pass
split like Phase 2. The ordering principle is **foundational caches first** (P3-1, then P3-4 builds on
it), then the page-local parallelizations and counts, then the keyset rebuild, then the Sentry cache.
PR-B (P3-2) is independent and can be built in parallel with PR-A.

Every change is verified to be data-shape-identical to its predecessor (same fields, same derived
values) before it is considered done; the keyset change is the only one whose *rendered output*
differs, and only in pagination affordance.

---

## 3. Sequencing

**PR-A (safe batch):**

1. **P3-1** — `getSessionProfile()` + `requireRole` rewire. Foundational; P3-3/P3-4 drop their name
   reads against it.
2. **P3-4** — `getAgentCoverage()` cache + agent layout/page rewire (consumes P3-1).
3. **P3-3** — owner home: stage-1 properties → stage-2 `Promise.all` (+ owner-home counts/last-call).
4. **P3-6** — admin-overview count queries (2-stage: operator reads, then per-property counts) +
   owner-calls keyset (`lib/owner/calls-cursor.ts` + page rewrite).
5. **P3-5** — `unstable_cache` wrapper for the Sentry probe + `/admin/status` rewire.

**PR-B (voice):**

6. **P3-2** — restage `incoming/route.ts`.

---

## 4. The changes (interfaces & shapes)

### P3-1 — `lib/auth/session.ts`

```ts
import { cache } from "react";
export type SessionProfile = {
  id: string; role: Role; operator_id: string;
  active: boolean; must_change_password: boolean;
  full_name: string; email: string;
} | null;

// Memoized per RSC render: one getUser + one profiles select, shared by layout + page.
export const getSessionProfile = cache(async (): Promise<SessionProfile> => { /* getUser → profiles */ });
```

`requireRole(role)` calls `getSessionProfile()`, then applies the **unchanged** redirect ladder
(`!profile || !active → /sign-in`; `must_change_password → /onboarding`; `role mismatch → /`) and
returns the (now richer) `RequiredProfile` (gains `full_name`, `email`). Callers that read a second
profiles row for the display name (`agent/layout.tsx`, `agent/page.tsx`, `admin/page.tsx`'s `me`,
owner shell) drop it and read the returned profile. Middleware unchanged.

### P3-2 — `app/api/twilio/voice/incoming/route.ts` (restage)

```
property = await (properties by routing_did)                       // gate — early return if !active
if (!property || !property.active) return notInService
void recordHeartbeat(property.operator_id, "twilio_webhook")        // detached (best-effort)
const [existing, primaryAgent, availableAdmins] = await Promise.all([
  fetchExisting(callSid),          // calls by sid → { id } | null
  resolvePrimaryAgent(property),   // assignment → profile → DialCandidate | null   (2 RTT, parallel)
  resolveAvailableAdmins(property),// availability → profiles → DialCandidate[]      (2 RTT, parallel)
])
const targets = planDial({ primaryAgent, availableAdmins })        // identical inputs
let callId = existing?.id ?? ""
if (!existing) { /* identical insert */ callId = inserted?.id ?? "" }
return twimlResponse(buildIncomingTwiml(targets, { … }))           // identical TwiML
```

8→4 critical-path hops. `resolvePrimaryAgent` / `resolveAvailableAdmins` are local async helpers
holding today's exact query logic. The `try/catch → buildApologyTwiml` wrapper and `SUPABASE_TIMEOUT_MS`
are unchanged.

### P3-3 — `app/(owner)/owner/page.tsx`

Stage 1: `properties` (needed for `propIds` + per-property tz). Stage 2 `Promise.all`:
- **agent chain** — `assignments` → `profiles` (2 RTT) → `effectivePresence` baked at read time (unchanged).
- **per-property calls** — for each property, `{ count(today, tz-window, head:true), latest ring_started_at (order desc limit 1) }` → `todayCount` + `lastCall`. Replaces the single 48h row-haul.
- **open incidents** — bounded row-fetch (`.in(propIds).neq(status,"RESOLVED")`), counted per property
  in JS (the open set is small — not a 1000-cap risk); just moved into the `Promise.all`.

### P3-4 — `lib/auth/agent-coverage.ts` (new) + agent shell

```ts
export const getAgentCoverage = cache(async (agentId: string): Promise<{
  ids: string[]; properties: { id: string; name: string; timezone: string }[];
}> => { /* assignments(primary_agent_id) → properties(.in(ids)) */ });
```

Agent **layout** and **page** both call it (cache keyed on `agentId`, stable per request) instead of
re-fetching assignments + properties. The page keeps its own handled-calls fetch (page-specific),
still `Promise.all`'d with the coverage read. Display name comes from `getSessionProfile` (P3-1).

### P3-5 — `lib/sentry/errors.ts` + `/admin/status`

```ts
// thin wrapper beside getRecentErrorCount (unchanged + still fetchImpl-injectable for tests)
export const getCachedErrorCount = unstable_cache(
  () => getRecentErrorCount(),
  ["status:sentry-error-count"],
  { revalidate: 60 },
);
```

`/admin/status` calls `getCachedErrorCount()`. Card may be ≤60s stale — acceptable for a health dot.
New pattern for the repo (no prior `unstable_cache` usage).

### P3-6 — counts + keyset

**Counts — `app/(admin)/admin/page.tsx`:** drop the `me` query (P3-1 supplies `full_name`) and the
48h calls row-haul. Stage 1 `Promise.all` keeps the operator-scoped reads but switches incidents to
`{ count: "exact", head: true }`; stage 2 `Promise.all` computes per-property tz-aware today counts
(`head: true`). Global "Calls today" = sum of per-property counts. Same integers, zero rows shipped,
no 1000-cap truncation. The tz today-window is a pure helper (`startOfTodayUtc(tz, now)`), unit-tested.

**Keyset — `lib/owner/calls-cursor.ts` (new) + `owner/calls/page.tsx`:**
```ts
export function encodeCursor(row: { created_at: string; id: string }): string;   // "<created_at>~<id>"
export function decodeCursor(s: string | undefined): { at: string; id: string } | null;
export function keysetOrFilter(c: { at: string; id: string }): string;           // PostgREST .or() string
```
Query: `.order("created_at",{ascending:false}).order("id",{ascending:false}).limit(50)`, and when a
cursor is present `.or(keysetOrFilter(c))` — `created_at.lt.<at>,and(created_at.eq.<at>,id.lt.<id>)`
(exact `.or()` nesting verified at implementation). `(created_at, id)` is a unique total order
(`created_at` NOT NULL; `id` PK), so pages neither skip nor duplicate. URL carries `?before=<cursor>`
(+ existing `property`/`channel`). Footer: **Older →** (set `before` to the last row's cursor) when a
full page returned; **← Newest** (clear `before`) when a cursor is present. Day-grouping per page is
unchanged. AutoRefresh re-reads the current page only.

---

## 5. What stays identical (the guarantee)

- **Every rendered value** except the owner-calls pagination affordance: same stats, same presence
  dots, same call/incident rows, same redirects, same TwiML/targets on the voice path.
- **No new env, no new migration, no RLS touch, no service-role surface added.**
- **Polling model unchanged** — `<AutoRefresh>` still `router.refresh()` on 20s + focus everywhere.

---

## 6. The one user-visible change

Owner **Calls** goes from *infinite-accumulate* ("Load more" grows one long day-grouped list) to
**pages of 50** (Older / Newest). Rationale: it's a call *log*, not a feed — pages read fine; the
growing window was a real cost cliff (P7/S10: AutoRefresh refetched the entire accumulated window
every 20s); and stateless cursor pages are the only keyset shape that fits the pure-RSC + AutoRefresh
architecture without bolting on client state. The property-detail "Recent calls" panel (which shares
`CallRow`) is unaffected — it shows a fixed recent slice, not the paginated history.

---

## 7. Test strategy

- **New pure helpers get focused unit tests:** `getSessionProfile` shape; `startOfTodayUtc(tz, now)`
  boundary cases (DST, tz offset); `encodeCursor`/`decodeCursor` round-trip + `keysetOrFilter` string;
  the per-property today-count derivation.
- **P3-2 extends `tests/app/twilio/incoming.test.ts`:** same `planDial` inputs and same TwiML for the
  primary-agent / admins / nobody-available cases; idempotent CallSid still no-ops the insert;
  `recordHeartbeat` is invoked with the operator id, and the response no longer awaits it (a
  slow/rejecting heartbeat still returns TwiML).
- **RSC pages (owner home, agent shell, admin overview, owner calls)** have no unit-test lane today;
  they are verified by typecheck + the extracted pure helpers + local render. The `cache()` dedup
  itself is a per-request memo (not unit-asserted) — guarded by the unchanged auth/redirect tests.
- **P3-5:** `getRecentErrorCount` unit tests unchanged (still called directly with `fetchImpl`).
- **Gate:** full `npm test` (node + jsdom lanes) green; `lint` + `typecheck` clean; both app builds.
  Net test count rises.
- **PR-B prod voice smoke (required before merge):** live inbound call → softphone rings (ringback
  audibly prompt) → answer → two-way audio → `calls` RINGING→IN_PROGRESS→COMPLETED; **and** the
  no-answer path → apology TwiML + `NO_ANSWER`. Voice only verifies on prod (Twilio points at the prod
  webhook), per the deploy-and-smoke workflow.

---

## 8. Risks & mitigations

- **Voice-path regression (highest).** P3-2 restages the live inbound webhook. *Mitigations:* query
  logic byte-identical; opus implementer + opus review on PR-B; minimal diff (no logic relocation,
  decision #7); route tests extended; **prod voice smoke** (both the answer and no-answer paths) before
  merge; heartbeat detach is safe because it was already documented best-effort (and only needs
  `property.operator_id`, available post-gate).
- **`cache()`/`requireRole` shape change.** Adding `full_name`/`email` is additive; redirects are
  copied verbatim. *Mitigation:* existing auth/redirect tests must stay green; the dedup is read-only.
- **Keyset correctness (skip/dup rows).** *Mitigation:* unique `(created_at, id)` total order +
  round-trip/`or`-string unit tests; the `.or()` nesting is explicitly verified against PostgREST at
  implementation, not assumed.
- **Count tz-window correctness.** Per-property "today" depends on each property's tz. *Mitigation:*
  reuse the semantics of the existing `countToday`/`countTodayCalls` (already tz-aware) via a pure
  `startOfTodayUtc` helper with DST/offset tests; counts cross-checked against the row-based result on
  seed data during local verify.
- **`unstable_cache` staleness.** `/admin/status` error count is ≤60s stale.
  *Mitigation:* acceptable for an at-a-glance dot; documented; the live Supabase/Twilio probes are
  unaffected.
- **Per-property count fan-out at scale.** N parallel count queries on admin/owner home. *Mitigation:*
  parallelized + `head:true` (no rows); negligible at pilot; the grouped-count RPC is the documented
  v2 collapse — explicitly deferred, not silently dropped.

---

## 9. References

- `docs/audits/2026-06-10-architecture-audit.md` + `…-triage.md` — findings + buckets (P1/P4/P5/P8/P6
  BUG; P2/S9, P7/S10 ACCEPT-RISK; S4 DEFER-V2)
- `CLAUDE.md` — locked decision #4 (polling, not subscriptions — preserved); established `lib/` TDD +
  RSC + 2-query patterns
- `docs/specs/2026-06-11-phase2-seam-extractions-design.md` — the seam (`api-actor.ts`) P3-1 sits beside
- `TASKS.md` — Phase 3 task list (P3-1…P3-6)
- `memory/build-quirks.md` / `~/.claude` `deploy-and-smoke-workflow` — voice verifies on prod only
