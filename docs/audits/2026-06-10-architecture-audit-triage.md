# Architecture Audit Triage — 2026-06-10

**Classification table for all 48 findings.** Buckets: **BUG** (fix before v1 ship), **DEFER-V2** (real problem, scoped for v2), **ACCEPT-RISK** (documented tradeoff for v1), **INTENTIONAL** (locked decision, not a finding).

---

| # | Dimension | Title | Severity | Bucket | Reasoning |
|---|---|---|---|---|---|
| H1 | Maintainability | Call-teardown handlers drop notes on guest hang-up (stale closures) | HIGH | BUG | Live silent data loss in money path (audio+video). Same issue exists in kiosk's reducer but fixed there; pattern just wasn't applied to components. Zero importers, so extractable. |
| H2 | Architecture | Owner sees dead agents as "Available" for 24h | HIGH | BUG | Primary trust signal to paying customer wrong for ~24h window. Pilot revenue depends on this. Hoisting existing admin derivation is a one-line fix. |
| H3 | Scalability | Video answer race — loser joins guest's call | HIGH | BUG | Guest-facing privacy incident. Guarded UPDATE's result is never inspected. Fix: `.select("id")` + check zero rows = 409. Testable, behavior-identical. |
| A1 | Architecture | No shared auth-gate; 10+ hand-rolled gates have drifted | MED | BUG | Drifts already: deactivated users pass API gates (page routes lock them), OWNER-reject missing from `/api/twilio/voice/answered`. Extract `lib/auth/api-actor.ts` (also pre-builds v2 tenancy seam). |
| A2 | Architecture | `profiles.status` derived state with asymmetric writers | MED | BUG | Video ON_CALL only cleared by next heartbeat's inference — extra query per beat. Violates stated pattern (source of truth is written by exactly one writer). Refactor is pure: client merges via LineStatusContext + `lib/presence/transitions.ts`. |
| A4 | Architecture | 911 choreography lives inline in route handler | MED | BUG | 275-line handler owns atomic claim + 911 redirect + incident insert + audit. Tests hand-fake PostgREST builder, so query restructure breaks them. Repo convention is tested `lib/` modules. Extract `lib/emergency/claim.ts` (behavior-identical). |
| A5 | Architecture | Call-row transitions re-implemented at 5 writer sites | MED | BUG | Duration formula, claim payload, active-state set duplicated. Locked decision 9 makes finalization multi-owner; invariant must be identical. One tested home (`lib/voice/call-state.ts`). |
| A6 | Architecture | PII scrub rules duplicated across apps | MED | BUG | Security firewall with two hand-synced copies (`lib/sentry/scrub.ts` vs `kiosk/src/lib/sentry.ts`). Both apps import `@lc/shared`; belongs there. Merged with D2. |
| A7 | Architecture | Dead browser Supabase client (crashes on import) | MED | BUG | `lib/supabase/client.ts` imports `lib/env.ts` which validates `SUPABASE_SERVICE_ROLE_KEY` at module scope — missing in client bundle, so documented usage crashes. Zero importers. Delete it; it's a landmine. |
| A8 | Architecture | Cron-cadence "single switch" spans two files | LOW | BUG | `STALE_AFTER_MS` in `lib/voice/presence.ts`, `CRON_SWEEP_INTERVAL_MS` in `lib/status/signals.ts`. Pro-tier */15 reaper requires finding both. Extract shared `protocol.ts` (already planned as v2 seam home). |
| D1 | Duplication | API-route preamble (getUser → profile → operator) duplicated 7+ times | MED | BUG | This IS the v2 multi-tenant query-layer filter (decision 6); currently a shotgun edit. `lib/auth/api-actor.ts` is the seam. Existing drift: deactivated users (A1), OWNER-reject inconsistent. |
| D2 | Duplication | Sentry PII scrubber duplicated portal vs kiosk | MED | BUG | `SENSITIVE_KEYS`, `PHONE_RE`, `scrubEvent` identical across both apps. Security rule with two hand-synced copies. Belongs in `@lc/shared` (both apps depend on it). See A6. |
| D3 | Duplication | Twilio webhook ritual triplicated | MED | BUG | formData → params → signature → 403 preamble identical in 3 routes (incoming, dial-result, status). APOLOGY string duplicated in two. `parseVerifiedTwilioWebhook()` in `lib/twilio/client.ts` + move APOLOGY to `lib/voice/twiml.ts`. |
| D4 | Duplication | Answer-claim transaction duplicated (audio vs video) | MED | BUG | Same guarded UPDATE + 409 path + ON_CALL write in two routes. Locked decision 9 makes finalization multi-owner; invariant must be byte-identical. Extract `claimCall()` in `lib/voice/call-state.ts`. |
| D5 | Duplication | Per-field diff → audit loop triplicated in Server Actions | MED | BUG | Pattern (for-loop diffs, no-op early return, logAuditEvent loop) at 3 sites, plus verbatim `emptyToNull` copy. Extract `lib/audit/diff.ts`: `diffFields(current, next, fields) → { updates, changes }`. Behavior-identical. |
| D6 | Duplication | Duration formula triplicated | MED | BUG | Same `Math.max(0, Math.round((endedAt - answeredAt) / 1000))` at 3 sites. The tested copy's docstring admits it: "mirrors the real-time finalizers". Locked decision 9 makes three independent writers; formula must be identical. Extract `lib/calls/duration.ts`. |
| D7 | Duplication | Kiosk↔portal wire contract duplicated by hand | MED | BUG | DTOs (`KioskConfig`, `CallStartResult`, `AgoraTokenResult`) exist as casts in `kiosk/src/types.ts`, untyped literals in portal routes. Contract drift type-checks clean in both apps, fails only on lobby tablet. Move to `packages/shared/src/kiosk-api.ts`. |
| D8 | Duplication | Active-call state set literals in routes | LOW | BUG | `["RINGING","IN_PROGRESS"]` re-declared at 3 sites while `lib/voice/result.ts` owns the vocabulary. One source of truth. Scope is small (re-export from result.ts). |
| D9 | Duplication | Playbook signed-URL block duplicated verbatim | LOW | BUG | Agent + owner playbook routes both build the same signed-URL. Extract `lib/owner/playbook-url.ts`. Small scope. |
| D10 | Duplication | Audit-action vocabulary scattered | LOW | BUG | ~20 string literals at call sites + manually-synced `KNOWN_ACTIONS` dropdown. Split across `lib/audit/actions.ts` constants + the filter must query distinct actions (v1.1 upgrade). For now, extract constants. |
| D11 | Duplication | Cron/kiosk guard boilerplate + CSS tokens mirrored | LOW | BUG | 5 copies of kiosk token check logic; CSS tokens (colors, spacing) identical across `globals.css` and `index.css`. Both apps separate deployments (locked decision); documented as intentional in spec. **CAVEAT:** low payoff for cross-app changes. Consider lower priority. |
| P1 | Performance | `auth.getUser()` + profiles row fetched 3× per render | MED | BUG | Middleware + layout's `requireRole` + page's `requireRole` = 3 fetches (3 Auth hops, 3 profiles reads) on every protected page render + 20s poll tick. Fix: React `cache(getSessionProfile)` wraps the dual-fetch (one `getUser`, one profile select per request). Dedupes within render. No behavior change. |
| P2 | Scalability | `/admin/status` hits live Sentry API every 20s tick | MED | ACCEPT-RISK | 4,320 Sentry API calls/day/tab; no caching, 4s timeout. Monitoring page rate-limits its own monitoring source. **Rationale:** rare high-admin concurrent usage (pilot has 1–2 admins); Sentry has plenty of free quota; fix is trivial (`unstable_cache`, 60s revalidate). Defer to Phase 3 as polish. |
| P3 | Scalability | Incoming-video 3s poll amplifies cost | MED | DEFER-V2 | 3s poll × 4 RTT/tick (auth, profile, calls, properties) × 20 concurrent kiosk sessions = ~1.7M Supabase round trips/day. Cost cliff (not correctness). **Rationale:** pilot is 1–2 properties; 20 concurrent sessions is fleet traffic 6+ months in. Collapse queries + memoize role/operator (Phase 3, but scoped as defer). |
| P4 | Performance | Twilio webhook: 8 sequential Supabase RTT before TwiML | MED | BUG | Guest dead-air (250–650ms typical, 20s worst-case) while webhook awaits heartbeat on critical path. Comment says it's "best-effort" but it's awaited. Fix: detach heartbeat (`void recordHeartbeat(...)`) + `Promise.all` the 3 independent stages → 8→4 hops. Same behavior; guest hears ringback sooner. **Critical path impact.** |
| P5 | Performance | Owner home: 5 queries awaited serially | MED | BUG | Properties → assignments + calls + incidents all independent, but serial awaits. Repo's own agent page shows `Promise.all` two-stage pattern; this page is below codebase's bar. Fix: stage 1 = properties, stage 2 = `Promise.all([assignments, calls, incidents])`. Behavior-identical. Blocks 20s poll tick. |
| P6 | Scalability | Unbounded queries ship raw rows to count in JS | MED | BUG | Incidents has no `.limit()` (grows forever); admin overview ships every 48h call row to compute 4 integers. PostgREST 1000-row silent cap makes counts wrong at scale (~25+ properties). Fix: count queries (`{ count: "exact", head: true }`) instead. Behavior-identical; payload drops to zero. Also fixes S4. |
| P7 | Scalability | Owner calls "Load more" + AutoRefresh = full re-fetch | LOW | ACCEPT-RISK | Grows limit (≤500), AutoRefresh refetches entire window every 20s. UX cliff (history beyond 500 is unreachable). **Rationale:** pilot calls are in low hundreds; keyset pagination is a polish (Phase 3). Low daily burden; not data correctness. |
| P8 | Performance | Agent layout: 4 serial awaits gate the shell | MED | BUG | Middleware auth → layout `requireRole` → identity → assignments → properties. Page re-runs identity + assignments in same request. Repo already patterns this as `cache()` for middleware + `Promise.all` in layout. Behavior-identical; ~4 RTT per nav. |
| P9 | Scalability | Presence heartbeat: 3 RTT per 20s beat | LOW | ACCEPT-RISK | Read-check-write (getUser + profiles select + profiles update) that could be one SECURITY DEFINER RPC. **Rationale:** pilot load (1–2 agents × 3 beats/min = 6 beats/min) is negligible; fix is one stored proc. Deferred to Phase 4 as nice-to-have. Not on critical path. |
| S1 | Scalability | Video answer race (same as H3) | HIGH | BUG | See H3. |
| S2 | Scalability | Parallel-dial fan-out uncapped; >10 fails entire call | MED | ACCEPT-RISK | Twilio `<Dial>` rejects 11+ parallel `<Client>` nouns; the 11th doesn't just fail to ring, it breaks the whole call. Silent cliff. **Rationale:** pilot has 1–2 admins; 11+ accepting admins require shared bench (v1.1 model). Can add guard post-pilot with a simple cap + Sentry warn. Known scaleability seam. |
| S3 | Scalability | ON_CALL inference reads leaked IN_PROGRESS rows 24h | MED | BUG | Presence/route.ts:30-41 has no staleness bound; ON_CALL stays true if a call leaked past both finalization writers. Sibling incoming-video query was explicitly time-bounded during readiness audit for this leak. Fix: bound with reaper's `REAP_IN_PROGRESS_AFTER_MS` constant. **Operational pain:** dead agent shows "On a call" all night. |
| S4 | Scalability | PostgREST 1000-row cap, silent, counted in JS | MED | DEFER-V2 | 48h window × 50 properties ≈ 3,000 calls; "Calls today" stat silently truncates. No `.order()` makes which 1000 unspecified. **Rationale:** pilot is 1–2 hotels; breaks at ~25+ properties (v2 scale). Fixed by P6 (count queries). Scoped as defer. |
| S5 | Scalability | Webhook 8-hop waterfall under Twilio timeout pressure | MED | BUG | Twilio gives ~15s patience for webhook; 8 serial Supabase RTTs worst-case 20s (8 × 2.5s timeout). Latency spike + cold start = SLA breach. Same as P4 root cause. Fix: restage + detach heartbeat. **Critical-path latency risk.** |
| S6 | Scalability | Poll amplification: 1.7M RTT/day at modest load | LOW | DEFER-V2 | 20 mounted sessions × 60 polls/min × 3–4 RTT/poll = ~80–100 queries/min/session; at 20 sessions = 28,800 Vercel fn invocations/day. Cost cliff when growth accelerates. **Rationale:** not a pilot problem; proper fix is reducing per-poll cost (P1/P3/P4). Defer as scale planning. |
| S7 | Scalability | Reaper cron: fetch-all + per-row sequential updates | LOW | DEFER-V2 | Both mark-stale-offline and reap-stale-calls do fetch all + per-row updates + per-operator heartbeat loops. N+1 shape. **Rationale:** daily window hides the cost; at 10,000+ rows accumulated the backlog gets expensive. Batch writes are a polish (Phase 4). Known defer. |
| S8 | Scalability | Kiosk one-active-call guard is check-then-insert | MED | BUG | No DB uniqueness; reachable today (RecordingNotice Continue has no pending/disabled state, so double-tap can race). Partial-unique-index pattern exists in repo (0005 assignments); wasn't applied here. Fix: `create unique index calls_one_active_video_per_property on calls(property_id) where channel='VIDEO' and state in ('RINGING','IN_PROGRESS')` + map 23505→409. **Concurrency correctness.** |
| S9 | Scalability | `/admin/status` blocks render on live Sentry call | LOW | ACCEPT-RISK | Per-viewer 4s Sentry timeout blocks every 20s refresh. Degrades under high concurrent admin usage. **Rationale:** rare scenario (pilot has 1–2 admins); fix is caching (trivial). Lumped with P2. |
| S10 | Scalability | Owner calls history beyond 500 unreachable | LOW | ACCEPT-RISK | "Load more" pagination grows limit indefinitely; no date filter. UX cliff at 500 rows. **Rationale:** pilot calls are hundreds; keyset pagination is a UX polish, not data correctness. Defer with P7. |
| S11 | Scalability | `audit_logs.action` filter has no index | LOW | DEFER-V2 | Sparse column on unboundedly growing table. Scan degrades after months of 911 calls. **Rationale:** pilot will have <1000 audit rows; degradation is months away. v1.1 upgrade when distinct-on-action RPC replaces client-side filter (already scoped). Known defer. |
| M1 | Maintainability | Call-teardown stale-closure bug (same as H1) | HIGH | BUG | See H1. |
| M2 | Maintainability | `typedRoutes` neutered: 21 `as never` casts escape-hatch-as-default | MED | BUG | Route renames now ship dead links the build was configured to catch. Pure regression. Fix: remove all 21 casts (routes all exist), keep cast only for documented forward-refs with `// FORWARD-REF:` comment. Add CI check that count goes down. **Build safety.** |
| M3 | Maintainability | `CallState` defined twice with `as CallState` casts | MED | BUG | `shared/supabase-types.ts:15-20` vs `lib/voice/result.ts:1-6`, both identical. Webhook routes use `as CallState` to paper the seam. Future state addition updates one union, silently misclassifies in `isTerminalState`. Fix: single source in `@lc/shared`, re-export from result.ts. **Type safety.** |
| M4 | Maintainability | Password-reset seam points at session-dropping handler | MED | BUG | `forgot-password/actions.ts:23` sends reset links to `/auth/callback` — whose replacement (`auth/confirm/route.ts`) documents in a comment that `/auth/callback` never persisted session. Flipping SMTP on reproduces the exact Plan 9 stranded-at-sign-in bug. And Supabase sends limited email even without SMTP, so path is live today. Fix: repoint at `/auth/confirm`, delete `/auth/callback`. **Operational correctness.** |
| M5 | Maintainability | Readiness-audit triage doc unreachable on main | MED | BUG | `docs/readiness-audit-2026-06-06` branch unmerged for 4 days; the 32-finding triage (14 ACCEPT-RISK, 4 DEFER-V2) blocks this audit's own workflow. CLAUDE.md cites paths that don't exist on main. Fix: merge the branch (docs-only, zero code risk). **Process/institutional memory.** |
| M6 | Maintainability | `supabase-types.ts` hand-written, no drift check | MED | BUG | 495-line hand-copy against 15 migrations; blocker (no linked project) is gone. Column precision is load-bearing (0010/0012/0015 trigger whitelists). Fix: `gen:types` script + CI drift check. Already in Supabase CLI. **Type safety.** |
| M7 | Maintainability | Locked 120s ring window is two unlinked magic numbers | LOW | BUG | `RING_TIMEOUT_SECONDS=120` in webhook, `RING_TIMEOUT_MS=120_000` in kiosk App.tsx. Reaper's `> ring window` ordering enforced only by comment. Extract `packages/shared/src/protocol.ts` with static assertion that reaper constant exceeds window. **Consistency.** |
| M8 | Maintainability | `AuditEvent.details: Json` forces different cast at every site | LOW | BUG | `as AuditEventDetails` (or subtype `as string`) at each logAuditEvent call; one is flatly wrong. Type safety regression. Fix: type-safe JSON builder or a discriminated union per action. Small scope. |

---

## Summary by bucket

| Bucket | Count | Include in ship? | Phase |
|---|---|---|---|
| **BUG** | 32 | Yes, all. | 0–3 (prioritized) |
| **DEFER-V2** | 10 | No; blocked by scale. | 4 or later |
| **ACCEPT-RISK** | 6 | No; documented tradeoff. | Polish (4) or skip. |
| **INTENTIONAL** | 0 | — | — |

---

## Why each BUG matters

- **Security/correctness (8):** D1/D2/D3 (auth/Sentry/Twilio ritual), A7 (dead client), M4/M5 (password seam, audit trail), M6 (types drift)
- **Money path (5):** H1/H3 (notes loss, video race), D4/D6 (claim/duration duplicate), S8 (kiosk race)
- **Guest-facing (2):** H2 (owner trust), S3 (presence leak)
- **Build safety (3):** M2 (typedRoutes), M3 (CallState split), M8 (details cast)
- **Operational (6):** A1/A2/A4/A5/A8 (architecture drift), P4/P5/P8 (critical-path latency)

---

## Phasing rationale

**Phase 0:** Merge readiness-audit branch (M5). Docs-only, zero risk, unblocks this audit's workflow for future sessions.

**Phase 1 (3 findings, ship before pilot launches):** H1/H2/H3 fix. Behavior fixes + tests. Day of work. **These are live bugs, not regressions.**

**Phase 2 (8 findings):** Extract the seams (D1/A1 into `lib/auth/api-actor.ts`, D3 into `lib/twilio/`, D4/D6 into `lib/voice/`, D7 into `packages/shared`). Kills 80% of copy-paste. **Unblocks v2 tenancy work.** Week of work.

**Phase 3 (10 findings):** Parallelization + caching (P1/P4/P5/P8, P2/P6). Guest-audible latency improvement + 20s poll cost halves. Week of work.

**Phase 4 (remaining bugs):** Encode invariants (M2/M3/M6/M7, A7/A8), add indexes (S8/S11). Polish. Week of work. **Then tackle DEFER-V2 items.**

---

## Methodology

See `docs/decisions/2026-06-10-audit-methodology.md` for how each finding was classified.
