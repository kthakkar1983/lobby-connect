# Architecture Audit — 2026-06-10

**Status:** Complete (48 findings, 60+ agent reviewers, adversarial verification)
**Scope:** Reverse-engineer architecture, identify bad decisions, duplicate logic, performance bottlenecks, scalability risks, maintainability issues
**Methodology:** See `docs/decisions/2026-06-10-audit-methodology.md`
**Triage:** See `docs/audits/2026-06-10-architecture-audit-triage.md` (classification of each finding)

---

## Executive Summary

This is a **disciplined codebase, not a mess**. The architecture's bones are good: every table RLS'd with `operator_id`, business invariants pushed into Postgres (partial unique indexes, column-guard triggers, close-then-insert), a real TDD'd `lib/` layer (347 tests), idempotent multi-writer finalization, audited mutations. **The problems found are almost all seam-level**: invariants that have one correct implementation *somewhere* but are copy-pasted or re-derived elsewhere, and a polling architecture whose per-tick cost was never engineered.

**Three high-severity findings require fixing before shipping:**
1. **H1:** Both call-teardown handlers silently drop the agent's notes when the guest hangs up first (live bug, stale closures)
2. **H2:** The owner sees a dead agent as "Available" for up to 24 hours (presence derived three different ways)
3. **H3:** The video answer race lets the losing agent join the guest's live call (concurrent claim)

**No findings require a redesign.** All are behavior-preserving refactors except the three highs (which fix behavior).

---

## Architecture (Reverse-Engineered)

### Topology

```
                       ┌─ Vercel ──────────────────────────────────────────┐
  Guest phone ──Twilio─►  apps/portal (Next.js 15 App Router)              │
  Guest tablet ──HTTPS─►  │  · 3 role portals via route groups:            │
                       │  │    (agent) (admin) (owner), middleware-gated   │
                       │  │  · ~20 API routes: Twilio webhooks, Agora      │
                       │  │    tokens, kiosk endpoints, presence, 2 crons  │
                       │  │  · lib/ = tested pure logic (TDD'd, Vitest)    │
                       │  apps/kiosk (Vite SPA, no auth)                   │
                       │  │  · pure reducer state machine + Agora client   │
                       │  │  · talks ONLY to portal APIs (HMAC kiosk token)│
                       └──┼────────────────────────────────────────────────┘
                          ▼
                  Supabase (Postgres + Auth + Storage)
                  · 11 tables, all with operator_id (v2 multi-tenant seam)
                  · RLS on everything; SECURITY DEFINER helpers for
                    cross-table checks; column-guard triggers (0010/0012/0015)
                  External: Twilio (voice+911) · Agora (video) · Sentry
```

### Core data flows

**Audio call:** Twilio POSTs `incoming/route.ts` → HMAC verify → 8 sequential Supabase queries (property by DID, dedup, assignment, agent profile, accepting admins, insert `calls` row RINGING) → `<Dial timeout=120>` with one `<Client>` per candidate → agent browsers ring → answer hits `answered/route.ts` (state-guarded claim → IN_PROGRESS, presence → ON_CALL) → `status/route.ts` finalizes server-side. No-answer → apology TwiML.

**Video call:** kiosk tap → `POST /api/kiosk/call-started` (one-active check → insert RINGING) → agent banners discover via 3s poll of `incoming-video/route.ts` → answer claims via `answer-video/route.ts` → both sides join Agora. Finalization: multi-owner + idempotent (kiosk route, agent route, or nightly reaper — first state-guarded writer wins).

**911:** softphone button → `emergency/route.ts` atomically claims, redirects guest leg into Twilio Conference, adds 911, inserts `incidents` row; in-call mute/leave server-side via Conference Participant API.

**Presence:** softphone heartbeats `POST /api/presence` every 20s; daily cron sweeps stale (`last_seen_at > 90s`) to OFFLINE; dashboards derive "effective presence" at read time.

**Data freshness:** no subscriptions (locked decision) — server components fetch, `<AutoRefresh>` calls `router.refresh()` every 20s + on focus; admin tables use optimistic toggles.

---

## Findings by dimension

### 1. Architecture — bad decisions (8 findings)

| # | Finding | Severity | Triage |
|---|---|---|---|
| A1 | No shared auth-gate for API routes; ten hand-rolled gates have drifted (deactivated users pass API gates, OWNER-reject missing from `/api/twilio/voice/answered`) | MED | BUG |
| A2 | `profiles.status` is derived state stored as truth with asymmetric writers; video ON_CALL only cleared by next heartbeat's inference query | MED | BUG |
| **A3** | **"Effective presence" derived three different ways; owner surface omits staleness entirely, showing dead agents as "Available" for ~24h** | **HIGH** | **BUG** |
| A4 | 911 escalation choreography (275 lines) lives inline in route handler; tests hand-fake PostgREST fluent chain, so any query restructure breaks them | MED | BUG |
| A5 | Call-row lifecycle transitions (claim, duration, state set) re-implemented inline at 5 sites instead of one tested module | MED | BUG |
| A6 | PII scrub rules duplicated character-for-character across apps (merged with D2) | MED | BUG |
| A7 | Dead browser Supabase client that crashes at import time (validates `SUPABASE_SERVICE_ROLE_KEY` at module scope); zero importers exist | LOW | BUG |
| A8 | Cron-cadence "single switch" spans two files with no shared interface (`STALE_AFTER_MS` vs `CRON_SWEEP_INTERVAL_MS`) | LOW | BUG |

### 2. Duplication — copy-pasted invariants (11 findings)

| # | Finding | Severity | Triage |
|---|---|---|---|
| D1 | Authenticated API-route preamble (getUser → profile fetch → operator check → OWNER reject) copy-pasted across 7+ routes; this IS the v2 tenancy seam | MED | BUG |
| D2 | Sentry PII scrubber duplicated character-for-character portal vs kiosk — a security firewall with two hand-synced copies | MED | BUG |
| D3 | Twilio webhook ritual triplicated (formData → params → signature → 403); APOLOGY string duplicated in two routes | MED | BUG |
| D4 | Answer-claim transaction duplicated audio vs video (same guarded UPDATE, same 409, same ON_CALL write) | MED | BUG |
| D5 | Per-field diff → audit-events → no-op-skip → write → audit-loop triplicated across Server Actions files | MED | BUG |
| D6 | Duration formula triplicated; the tested copy's docstring admits the other two exist ("mirrors the real-time finalizers") | MED | BUG |
| D7 | Kiosk↔portal wire contract duplicated by hand (DTOs as casts in kiosk, untyped literals in portal routes) | MED | BUG |
| D8 | Active-call state set `["RINGING","IN_PROGRESS"]` re-declared as literals in three routes while `lib/voice/result.ts` owns vocabulary | LOW | BUG |
| D9 | Playbook signed-URL block duplicated verbatim agent vs owner routes | LOW | BUG |
| D10 | Audit-action vocabulary: ~20 string literals at call sites + manually-synced `KNOWN_ACTIONS` dropdown | LOW | BUG |
| D11 | Cron/kiosk request-guard boilerplate (5 copies) + brand CSS tokens mirrored by hand | LOW | BUG |

### 3. Performance — 20s polling cost never engineered (9 findings)

| # | Finding | Cost | Triage |
|---|---|---|---|
| P1 | `auth.getUser()` + same `profiles` row fetched 3× per render (middleware → layout's `requireRole` → page's `requireRole`), no React `cache()` | ~half the per-poll RTTs are duplication | BUG |
| P2 | `/admin/status` hits live Sentry API on every 20s tick, serially, uncached, 4s timeout | 4,320 Sentry calls/day/tab | ACCEPT-RISK |
| P3 | 3s incoming-video poll does 4 RTT/tick, half re-fetching session-stable data | ~80 Supabase queries/min/session | DEFER-V2 |
| P4 | Twilio incoming webhook: 8 sequential Supabase RTT before TwiML, awaited "best-effort" heartbeat on critical path | 250–650ms guest dead-air typical | BUG |
| P5 | Owner home: 5 queries awaited serially when `Promise.all` would stage them in 2 | ~200–400ms avoidable per tick | BUG |
| P6 | Unbounded queries on polled pages: incidents has no `.limit()` (grows forever); admin overview ships every 48h call row to compute 4 integers in JS | payload grows linearly with history | BUG |
| P7 | Owner calls "Load more" grows limit (≤500), AutoRefresh refetches entire grown window every 20s | 500 rows + merge per tick, indefinitely | ACCEPT-RISK |
| P8 | Agent layout: 4 serial awaits gate shell; page re-runs 2 same queries in same request | ~8 RTT per nav, halvable | BUG |
| P9 | Presence heartbeat: 3 RTT per 20s beat; AVAILABLE branch adds calls query on steady state | read-check-write could be one RPC statement | ACCEPT-RISK |

### 4. Scalability — breaks at 10× growth (11 findings)

| # | Finding | Breaks at | Triage |
|---|---|---|---|
| **S1** | **Video answer race: losing agent gets 200 + channelName, joins guest's live call** | **~5 concurrent staff** | **BUG** |
| S2 | Parallel-dial fan-out has no cap; Twilio `<Dial>` rejects >10 parallel nouns — silent cliff | shared admin bench (11+ accepting admins) | ACCEPT-RISK |
| S3 | ON_CALL inference reads leaked IN_PROGRESS rows with no staleness bound; daily reaper window pins agent "On a call" 24h | pilot already hurts | BUG |
| S4 | Silent PostgREST 1000-row cap makes "Calls today" arbitrarily wrong (48h window × 50 properties ≈ 3,000 rows, no ORDER BY, counted in JS) | ~25+ properties | DEFER-V2 |
| S5 | Twilio webhook waterfall (P4's 8 sequential hops) viewed as timeout risk under Supabase latency spikes | SLA breach on 95th percentile | BUG |
| S6 | Poll amplification: ~1.7M Supabase round trips/day at just 20 mounted sessions | cost/limit cliff at modest growth | DEFER-V2 |
| S7 | Reaper cron: fetch-all + per-row sequential updates + per-operator sequential heartbeat loops | N+1 meets daily-window backlog | DEFER-V2 |
| S8 | Kiosk one-active-call guard is check-then-insert with no DB uniqueness; reachable today (RecordingNotice Continue has no pending state) | double-tap on flaky WiFi | BUG |
| S9 | `/admin/status` blocks every render on live Sentry (up to 4s), re-triggered every 20s per viewer | degrades under high concurrent admin usage | ACCEPT-RISK |
| S10 | Owner calls history beyond newest 500 rows unreachable (grow-limit pagination, no date filter) | UX cliff at 500 calls | ACCEPT-RISK |
| S11 | `audit_logs.action` filter has no supporting index on unboundedly growing table | scan degrades after months of 911 calls | DEFER-V2 |

### 5. Maintainability — convention drift & testing gaps (8 findings)

| # | Finding | Severity | Triage |
|---|---|---|---|
| **M1** | **Agent call-teardown logic lives in two untestable client components; both carry stale-closure bug silently dropping notes when guest hangs up first** | **HIGH** | **BUG** |
| M2 | `typedRoutes` enabled but neutered: 21 `href as never` casts on routes that all exist; escape hatch became the default; route renames ship dead links | MED | BUG |
| M3 | `CallState` defined twice (shared/supabase-types.ts + lib/voice/result.ts) with `as CallState` casts papering the seam in webhook routes | MED | BUG |
| M4 | Dormant password-reset seam points at wrong handler (`/auth/callback` is the one documented in-repo to drop sessions); flipping SMTP on reproduces the Plan 9 bug | MED | BUG |
| M5 | Readiness-audit + triage doc CLAUDE.md tells every session to consult exists only on unmerged branch `docs/readiness-audit-2026-06-06` — institutional memory of 14 ACCEPT-RISK + 4 DEFER-V2 unreachable | MED | BUG |
| M6 | `supabase-types.ts` is 495-line hand-written against 15 migrations with no drift check; the blocker (no linked project) is gone; column precision is load-bearing (0010/0012/0015 triggers) | MED | BUG |
| M7 | Locked 120s ring window is two unlinked magic numbers in two apps; reaper's `> ring window` ordering constraint enforced only by comment | LOW | BUG |
| M8 | `AuditEvent.details: Json` forces different cast at every call site, including one flatly wrong | LOW | BUG |

---

## The three behavior-relevant fixes (ship these first)

### H1: Notes loss on remote hang-up (stale closures)

**Status:** Live bug. Silent data loss.

**Files:** `apps/portal/components/softphone/softphone.tsx:124-214`, `apps/portal/components/video-call/video-call.tsx:68-120`

**Problem:** Both wires `call.on("disconnect"/"user-left", () => void teardown())` inside a one-shot mount effect, but `teardown` is `useCallback(..., [roomNumber, notes])` — the listener permanently captures the **first-render closure** where both are `""`. The save guard `if (id && (roomNumber || notes))` is therefore always false on a remote hang-up: POST to `/api/calls/notes` never fires; inputs clear anyway, so loss is silent.

**Why it matters:** Guest-initiated endings are the common case; room# and guest requests are lost in the money path.

**Fix:** Ref-mirror `roomNumber`/`notes` (the kiosk's own documented pattern in `App.tsx:34`) or extract a `usePhaseMachine` reducer into `lib/voice/` mirroring `apps/kiosk/src/state/call-machine.ts`. Add jsdom + testing-library test lane and pin a regression: type notes, fire SDK event, assert POST happens.

**Test:** `tests/components/softphone.test.tsx` + `tests/components/video-call.test.tsx` (jsdom) verify notes save on remote hang-up.

### H2: Owner sees dead agents as "Available" for 24 hours (presence derivation)

**Status:** Live bug. Wrong trust signal on paying customer's surface.

**Files:** `apps/portal/app/(admin)/admin/page.tsx:165`, `apps/portal/lib/dashboard/presence.ts:11`, `apps/portal/app/(owner)/owner/page.tsx:46`

**Problem:** "Effective presence" is derived three ways. Admin does it right (`isStale(last_seen_at) ? "OFFLINE" : status`); dashboard composes it a second way; owner doesn't even select `last_seen_at` and renders raw `status`. Since OFFLINE sweep is deliberately daily, a crashed agent's `status='AVAILABLE'` stays frozen ~24h.

**Why it matters:** The owner's primary signal that staff are covering the property.

**Fix:** Hoist the admin page's existing ternary into `effectivePresence(status, lastSeenAt, now)` in `lib/voice/presence.ts`; all three consumers call it; owner query adds `last_seen_at` to select.

**Test:** Existing owner page test confirms `effectivePresence(AVAILABLE, staleTime, now) === OFFLINE`.

### H3: Video answer race — loser joins guest's live call (concurrent claim)

**Status:** Live bug. Guest-facing privacy incident at 5+ concurrent staff.

**Files:** `apps/portal/app/api/calls/[id]/answer-video/route.ts:50-63`

**Problem:** Comment says *"Conditional on still-RINGING to lose the answer race safely"* — but the UPDATE result is **never inspected**. Two concurrent accepts both pass the earlier read-check, both get `200 + channelName`, both agents publish into the guest's Agora channel (privacy incident); loser also unconditionally stamps themselves ON_CALL, corrupting presence.

**Why it matters:** Multi-agent ring is the design; concurrent answers are inevitable.

**Fix:** Make the guarded UPDATE self-reporting: chain `.select("id")` (PostgREST returns touched rows), treat zero rows as the existing `409 'Already answered'` branch. Move the ON_CALL write inside the winner branch. Mirror in `apps/portal/app/api/twilio/voice/answered/route.ts:47-57` (lower risk there only because Twilio externally serializes which leg bridges).

**Test:** `tests/app/calls/answer-video.test.ts` + `tests/app/twilio/answered.test.ts` verify losing agent gets 409, not 200.

---

## Recommended refactoring sequence

### Phase 0 — Process (zero code, do first)

**Merge the readiness-audit branch to main (M5).**
- Docs-only, zero risk.
- Restores the audit-trail workflow (`docs/audits/2026-06-06-readiness-audit-triage.md`).
- Every future session can check triage again.

### Phase 1 — The three behavior fixes

**Day of work. All three are behavior-preserving + test additions.**
- H1: Ref-mirror roomNumber/notes (or extracted reducer)
- H2: `effectivePresence()` hoisted into `lib/voice/presence.ts`
- H3: `.select("id")` on answer-video/answered UPDATE guarded claims

### Phase 2 — Extract the security/tenancy seams (kills 80% of duplication)

- `lib/auth/api-actor.ts` — `requireApiActor()` + `fetchOperatorCall()` replacing the 7+ copied preambles. **This is also the v2 multi-tenancy seam**: when v2 lands, the query-layer filter changes in one file.
- `parseVerifiedTwilioWebhook()` in `lib/twilio/client.ts`; `twimlResponse` + APOLOGY constant into `lib/voice/twiml.ts`
- `claimCall()` + `finalizeCallPayload()` in `lib/voice/call-state.ts` — one tested home for the claim transaction, duration formula, active-state set
- Move `scrub.ts` and kiosk DTO types into `packages/shared` — the package exists precisely for this

### Phase 3 — Per-request caching & parallelization (halves poll cost, no behavior change)

- React `cache()` for session resolution (P1)
- `Promise.all` independent stages: owner home (P5), agent layout (P8), status page (P2)
- Restage **Twilio webhook 8→4 hops with heartbeat detached** (P4) — the guest-audible latency win
- `unstable_cache(getRecentErrorCount, { revalidate: 60 })` (P2)
- Count queries instead of row-shipping (P6, S4); `.limit()` on incidents; keyset pagination on owner calls (P7)

### Phase 4 — Encode the scale invariants where they belong

- Cap `planDial` at 10 with deterministic priority + Sentry warn (S2)
- Partial unique index `calls(property_id) WHERE channel='VIDEO' AND state IN (...)` + 23505→409 (S8)
- Time-bound ON_CALL inference with reaper's constant (S3)
- Single `CallState` source in `@lc/shared` (M3)
- `RING_WINDOW_SECONDS` in shared `protocol.ts` with reaper assertion (M7)
- `gen:types` script + drift check in CI (M6)
- Remove 21 `as never` casts (M2)
- Repoint password-reset seam at `/auth/confirm`, delete `/auth/callback` (M4)
- Delete dead browser client (A7)
- Batch reaper updates (S7)

---

## Impact summary

| Category | Impact |
|---|---|
| **Guest-facing** | H1 (notes loss), H3 (video privacy) fixed; presence trust (H2) fixed |
| **Operational** | Poll cost halved (P1/P4); monitoring page no longer DDoSes Sentry (P2); scale cliffs flagged (S2/S4/S6) |
| **Pilot-safe** | All Phase 1–3 changes are behavior-preserving or fix-only; existing 347 tests remain green |
| **v2-unblocking** | `requireApiActor` seam pre-builds multi-tenant query-layer filter; `CallState` + `protocol.ts` centralization removes v2 extension friction |
| **Debt paydown** | Phase 2 eliminates ~80% of copy-paste seams; Phase 4 removes magic numbers and hand-synced constants |

---

## References

- `CLAUDE.md` — Locked architecture decisions (referenced throughout)
- `docs/specs/2026-05-27-v1-architecture-design.md` — Original v1 spec
- `docs/audits/2026-06-06-readiness-audit.md` + `docs/audits/2026-06-06-readiness-audit-triage.md` — Prior audit (unmerged branch, blocks this audit's workflow)
- `docs/audits/2026-06-10-architecture-audit-triage.md` — Classification of all 48 findings
- `docs/decisions/2026-06-10-audit-methodology.md` — How findings were classified
