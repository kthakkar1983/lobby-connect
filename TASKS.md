# Tasks — Lobby Connect

## Status key: [ ] todo · [x] done · [~] in-progress · [-] blocked · [s] skipped

---

## Audit Remediation (2026-06-10 architecture audit)
> Source: comprehensive 48-finding audit. Phases sequenced: behavior fixes first, then seam extractions, then perf, then scale invariants.

### Phase 0 — Process (zero code)
- [x] **P0-1** Merge `docs/readiness-audit-2026-06-06` branch to main (M5 — restores institutional memory of ACCEPT-RISK / DEFER-V2 decisions; docs-only, zero risk)

### Phase 1 — Three behavior fixes ⚠
- [x] **H1** Fix stale-closure notes loss in softphone.tsx + video-call.tsx (ref-mirror roomNumber/notes; add jsdom+testing-library lane + regression test)
- [x] **H2** Fix owner portal showing dead agents as "Available" — `effectivePresence()` added to lib/voice/presence.ts; owner home fetches last_seen_at + bakes effective status into cards at read time. 3 new tests.
- [x] **H3** Fix video answer race — `answer-video` UPDATE now uses `.select("id")`; zero rows → 409; ON_CALL write gated to winner only. 1 new test (concurrent-claim case). 351 tests total.

### Interlude — Notes durability + error surfacing + owner Calls tab ✅
- [x] **N1** `reliableFetch` helper (retry network/5xx + Sentry on exhaustion); call-notes save decoupled from call phase with a preserved-text Retry/Discard banner (softphone + video-call); `answered` / `emergency-control` (incl. observable live-911 mute) / `end-video` routed through it; emergency *trigger* stays bespoke + Sentry; 20s heartbeat best-effort by design. Owner Calls tab: note icon + inline accordion expand (shared `CallDetailBody`) + Audio/Video filter; property-page recent-calls parity. Branch `feat/notes-and-errors`, 7 commits, 360 tests. Spec/plan: `docs/specs/2026-06-10-notes-and-errors-design.md` · `docs/plans/2026-06-10-notes-and-errors.md`

### Phase 2 — Extract security/tenancy seams ✅ DONE (PR #18 merged `7c553e8`)
> Spec/plan: `docs/specs/2026-06-11-phase2-seam-extractions-design.md` · `docs/plans/2026-06-11-phase2-seam-extractions.md`. Brainstorm→spec→plan→subagent-driven (per-task spec+code review, opus on 911 + opus whole-branch final → GO). 411 tests. **Prod smoke CONFIRMED** (Kumar, 2026-06-12): audio answer, video answer+end, deactivated→403, OWNER→403 on `/answered` — all good.
- [x] **P2-1** `lib/auth/api-actor.ts` — `requireApiActor()` + `fetchOperatorCall()` across all 12 session routes; **behavior fixes:** `profiles.active`→403 gate + OWNER-reject on `/answered` (and agent `playbook`)
- [x] **P2-2** `parseVerifiedTwilioWebhook()` (`lib/twilio/client.ts`) + `APOLOGY_MESSAGE`/`twimlResponse` (`lib/voice/twiml.ts`)
- [x] **P2-3** `claimCall()` + `finalizeCallPayload()` + `ACTIVE_CALL_STATES` (`lib/voice/call-state.ts`) + `computeDurationSeconds()` (`lib/calls/duration.ts`) — `/answered` claim now H3-guarded too
- [x] **P2-4** PII scrubber + kiosk↔portal DTOs → `packages/shared` (`@lc/shared`)
- [x] **P2-5** `diffFields()` + `emptyToNull()` → `lib/audit/diff.ts` (properties actions; `users/actions.ts` keeps bespoke per-field diffing by design)
> Deferred follow-ups (non-blocking): harden `claimCall` to throw on DB error (task chip filed); `emptyToNull` dup in owner-properties actions; reaper builds finalize payload inline.

### Phase 3 — Per-request caching & parallelization
> **PR-A (P3-1/P3-3/P3-4/P3-5/P3-6) BUILT + opus whole-branch GO** on `feat/phase3-perf-parallelization` (`2b1b52c…af5423e`); 407 tests + lint + typecheck + `next build` green; **awaiting Kumar's local review → push/merge**. **PR-B = P3-2 voice restage** (opus, branch off `main` + prod voice smoke) NOT started. Spec/plan: `docs/specs/2026-06-12-phase3-perf-parallelization-design.md` · `docs/plans/2026-06-12-phase3-perf-parallelization.md`.
- [~] **P3-1** Wrap session resolution in React `cache()` — one `getUser` + one profiles read per request (P1: ~half the RTT per poll tick) — *built (PR-A)*
- [ ] **P3-2** `Promise.all` the Twilio incoming webhook 8→4 hops + detach the heartbeat (P4: guest-audible latency — most impactful perf win)
- [ ] **P3-3** `Promise.all` owner home independent stages (P5: ~200–400ms avoidable per tick)
- [ ] **P3-4** `Promise.all` agent layout independent stages (P8)
- [ ] **P3-5** `unstable_cache` Sentry error count (P2: 4,320 calls/day/tab → once/min max)
- [ ] **P3-6** Count queries instead of row-shipping on admin overview + `.limit()` on incidents + keyset pagination for owner calls (P6/P7/S4/S10)

### Phase 4 — Encode scale invariants in Postgres/code
- [ ] **P4-1** Cap `planDial` at 10 with deterministic priority + Sentry warn on truncation (S2: Twilio rejects >10 parallel nouns — breaks the entire call)
- [ ] **P4-2** Partial unique index `calls(property_id) WHERE channel='VIDEO' AND state IN ('RINGING','IN_PROGRESS')` + 23505→409 (S8: kiosk double-tap race)
- [ ] **P4-3** Time-bound ON_CALL inference with the reaper's exported constant (S3: crashed agent "On a call" all night)
- [ ] **P4-4** Single `CallState` source in `@lc/shared` (M3: defined twice, `as CallState` casts)
- [ ] **P4-5** `RING_WINDOW_SECONDS` in shared `protocol.ts` (M7: two unlinked magic numbers)
- [ ] **P4-6** `gen:types` script + drift check in CI (M6: 495 hand-written type lines, no drift check)
- [ ] **P4-7** Remove the 21 `href as never` casts (M2: typed routes neutered)
- [ ] **P4-8** Repoint password-reset seam at `/auth/confirm`; delete dead `/auth/callback` (M4: dormant SMTP path reproduces the fixed session-drop bug)
- [ ] **P4-9** Delete dead browser Supabase client in `lib/supabase/client.ts` (A7)
- [ ] **P4-10** Batch reaper UPDATE queries (S7)

---

## Pilot Launch (ongoing)
- [x] All migrations applied to prod (0001–0015)
- [x] Both apps deployed green on Vercel
- [x] Smoke §1–§4 + §6–§7 PASS
- [x] Emergency 933 smoke DONE; EMERGENCY_DIAL_NUMBER reverted to 911
- [x] UI/UX all 4 phases complete (Stage 1 foundation + Stage 2 ×3 surfaces + Stage 3 polish)
- [x] Font swap: Solitude→Atelier, Vonique→Radon (crossed-W fixed)
- [x] Kiosk ~120s video disconnect bug FIXED

### Still open
- [x] **Phase 2 prod smoke** (PR #18) — ✅ CONFIRMED 2026-06-12: audio answer (claim→IN_PROGRESS+ON_CALL), video answer+end (finalize+duration), deactivated-user→403, OWNER→403 on `/answered`
- [ ] Page-by-page final-polish pass (kiosk subtle shadows + bounce, one screen at a time; gate on prefers-reduced-motion; live in-browser a11y pass)
- [ ] Visual confirm: Atelier headings + Radon labels on prod kiosk (esp. W-bearing hotel names)
- [x] Save audit to repo: `docs/audits/2026-06-10-architecture-audit.md` (+ triage + methodology, `8cd551f`)
- [ ] Pilot go-live
