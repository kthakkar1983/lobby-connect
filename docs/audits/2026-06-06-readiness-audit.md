# Lobby Connect — Pre-Launch Readiness Audit

**Date:** 2026-06-06
**Scope:** Full codebase — portal (`apps/portal`) + kiosk (`apps/kiosk`) monorepo, Supabase schema/RLS, Twilio voice, Agora video, the 911 emergency path.
**Target:** v1 single-hotel pilot.
**Type:** Audit only — no code was changed.

## Method

Multi-agent workflow: 10 finder agents fanned out across five dimensions × surface area (security ×4, reliability ×3, performance ×2, stability ×1). Every finding was then re-read by an independent skeptic agent that opened the cited code, confirmed the defect was real, and re-rated severity by exploitability × blast radius for a single-hotel v1 pilot — false positives dropped. Findings were grounded in real signals, not just code reading: Supabase `get_advisors` (security + performance) on the prod project (`ztunzdpmazwwwkxcpyfp`), live prod table/row inspection, and the repo's own build-quirk history.

- **61 agents · ~3.0M tokens · 772 tool calls.**
- **50 candidate findings → 45 confirmed, 5 dropped** as false positives.
- **Severity mix: 0 CRITICAL · 5 HIGH · 14 MEDIUM · 26 LOW.**
- Prod data at audit time is tiny (operators=1, profiles=4, properties=1, calls=26, audit_logs=42, incidents=0), so every performance finding is **scale-readiness, not current load**.

---

## Go-to-market verdict

**NO-GO until the two 911-path defects and the video-call authorization hole are fixed — then GO-WITH-FIXES.** There are **5 HIGH blockers and 0 CRITICAL**, but three sit directly on the life-safety 911 path or expose live guest A/V — an unacceptable launch posture for a service that dials emergency services. The single determining issue: a transient Supabase blip during a 911 escalation silently hangs up the guest into a dead conference while the agent UI still reads "911 active" (`dial-result/route.ts:49`). None of the five HIGH items is large; all are fixable in well under a day each. **The gate is fix-then-ship, not redesign.**

---

## Per-dimension assessment

**Security — at-risk.** The video-call API routes (`answer-video`, `end-video`, `incoming-video`, `agora/token` branch 2) authorize on `operator_id` only with no role/assignment gate, so in single-operator v1 any authenticated OWNER or unassigned AGENT can enumerate and join a live guest video stream (`answer-video/route.ts:38`). Secondary risks are latent rather than live: cron routes fail-open if `CRON_SECRET` is ever unset (currently set in prod), and the kiosk config token is non-expiring/unrevocable (exposes WiFi password + ring-spam DoS, but gated by physical tablet possession). Password policy is weak (8-char, leaked-password protection off) but mitigated by invite-only provisioning.

**Reliability — at-risk.** This is the weakest dimension and the source of all three safety-critical HIGHs. Emergency 911 trigger is not atomically idempotent (double-tap places two PSAP calls, `emergency/route.ts:80`); a partial dispatch failure strands the guest in a dead conference with a false "911 active" banner (`emergency/route.ts:129`); and a transient Supabase read error in `dial-result` silently hangs up the guest instead of joining 911 (`dial-result/route.ts:49`). Separately, hard-deleting any real user fails on RESTRICT FKs *after* the audit row is already written, breaking a shipped admin feature and corrupting the audit trail.

**Stability — acceptable.** Env validation covers only 4 of ~20 vars, so Twilio/Agora/kiosk/cron misconfig fails lazily during live traffic rather than at boot — a real operability gap, fixable with a boot-time assertion in `instrumentation.ts`. The Twilio Device / Agora client glue is untyped (`any`) and untested, so an SDK rename could pass all 257 tests and only break on a live call, but manual prod smoke-testing gates that class of regression. No outage-class instability today.

**Performance — solid (at pilot scale).** Every perf finding is LOW and forward-scale only: the owner call-list orders by an unindexed `ring_started_at` (seq-scan + sort, ~0.8ms on 26 rows), RLS quals re-evaluate `auth.uid()` per row (`auth_rls_initplan`), and `AutoRefresh` refetches on every focus with no debounce. None matters at one hotel / 26 calls, but the `ORDER BY` swap and the `(select auth.uid())` wrap are cheap and worth doing before volume grows.

**Speed — solid.** Frontend is well-structured: the heavy `agora-rtc-sdk-ng` runtime is correctly lazy-loaded, only a few KB of wrapper component ships eagerly, and the remaining items (`next-themes` dead dep, missing `optimizePackageImports` for the radix meta-package) are trivial bundle hygiene with negligible impact.

---

## Prioritized action list

### Blockers — fix before pilot

1. **[HIGH] A transient Supabase read error in the 911 re-join silently hangs up the guest into a dead conference.** `apps/portal/app/api/twilio/voice/dial-result/route.ts:49` — the discarded `error` on the `existing` read makes the emergency-conference branch fall through to hangup. **Fix:** have `/emergency` proactively redirect the guest parent leg into the conference (as it already does in its fallback at lines 124-127) so the guest's connection does not depend on this callback read; or re-read with bounded retry and, on error, default to re-joining when the stamp is present.

2. **[HIGH] Partial 911 dispatch failure strands the guest in a silent conference while the agent UI shows "911 active".** `apps/portal/app/api/calls/[id]/emergency/route.ts:129` — on total dispatch failure the stamp is never rolled back and the failure is console-only. **Fix:** on no-agent-leg-AND-no-911-participant, clear `emergency_conference_name` so the guest stays on the normal bridge, return an explicit "dispatch failed — relay verbally / have guest dial 911 directly" state to the agent UI (`softphone.tsx` must roll back `emergencyActive` on non-ok), and mark the incident `FAILED`/degraded rather than plain `OPEN`.

3. **[HIGH] Emergency 911 trigger is not atomically idempotent — double-tap/retry places TWO PSAP calls.** `apps/portal/app/api/calls/[id]/emergency/route.ts:80` — read-then-stamp TOCTOU with no DB guard. **Fix:** make the stamp the atomic claim — `update({emergency_conference_name}).eq("id",id).is("emergency_conference_name",null).select()` and only dial if exactly one row returns; add a partial-unique-index / NOT-NULL-once invariant as belt-and-suspenders.

4. **[HIGH] Video-call API routes have no role/assignment gate — any authenticated OWNER or unassigned AGENT can join a live guest video stream.** `apps/portal/app/api/calls/[id]/answer-video/route.ts:38` (also `end-video`, `incoming-video`, and `agora/token` branch 2 at `apps/portal/app/api/agora/token/route.ts:58`) authorize on `operator_id` only. **Fix:** reject OWNER on all four routes; for AGENT scope to `user_is_assigned_to_property(call.property_id)` / primary-agent / accepting-admin, mirroring the `canTriggerEmergency` handled-by pattern.

5. **[HIGH] Hard-deleting any real user fails on RESTRICT FKs but the `user.deleted` audit row is already written — feature broken + phantom audit entries.** `supabase/migrations/0001_init.sql:93` (also `:120`, `:121`, `:157`, and `0008_incidents_emergency.sql:17`) plus `apps/portal/app/(admin)/admin/users/actions.ts:235`. **Fix:** migration setting `calls.handled_by_user_id` and `incidents.triggered_by` to `ON DELETE SET NULL` (mirror 0003), and `property_assignments.*` / `properties.owner_user_id` to SET NULL or a precondition block; move the audit write to *after* a successful delete (or write attempt + outcome).

### Should-fix — MEDIUM

6. **[MEDIUM] Emergency caller ID is used with no verification it has a registered E911 address — wrong-PSAP/wrong-address routing, silent failure.** `apps/portal/lib/emergency/dispatch.ts:23` returns `routing_did` (admin-editable, no E911 check) unvalidated. **Fix:** validate the chosen from-number against Twilio's registered emergency address at trigger time (or select from a verified `emergency_caller_id` allowlist), and audit the exact caller ID used.

7. **[MEDIUM] No timeout/abort on Supabase/Twilio calls in the Twilio voice webhooks — a hung dependency gives the guest dead air past Twilio's HTTP limit.** `apps/portal/app/api/twilio/voice/incoming/route.ts:49` (and dial-result, emergency REST redirects). **Fix:** wrap critical-path queries in `AbortSignal.timeout(~2500ms)` via a custom `fetch` in `createAdminClient`, falling through to `buildApologyTwiml`; set a route `maxDuration`.

8. **[MEDIUM] No bounded timeout on the agent 911-escalation REST calls — the button can hang with no client-visible failure on the irreversible path.** `apps/portal/app/api/calls/[id]/emergency/route.ts:113` — Twilio REST client and the stamp update have no timeout. **Fix:** add a `timeout` to the Twilio client and per-call abort signals; surface "dispatch delayed — dial 911 directly" to the agent UI on timeout.

9. **[MEDIUM] Cron routes fail-open when `CRON_SECRET` is unset, and `CRON_SECRET` is never validated at boot.** `apps/portal/app/api/cron/reap-stale-calls/route.ts:19` and `mark-stale-offline/route.ts:11` wrap the Bearer check in `if (secret)`. **Fix:** add `CRON_SECRET` to `lib/env.ts` `required()`, and make the check unconditional — `if (!secret || auth !== ` + "`Bearer ${secret}`" + `) return 401`. (Currently mitigated: secret is set in prod.)

10. **[MEDIUM] `env.ts` validates only 4 of ~20 vars — Twilio/Agora/kiosk secrets fail lazily during live traffic instead of at deploy.** `apps/portal/lib/env.ts:16`. **Fix:** add an `instrumentation.ts` `register()` that calls `getTwilioConfig()`, `getAgoraCredentials()`, `getKioskConfigSecret()` and reads `CRON_SECRET` once at boot inside try/catch, keeping call-time readers for testability.

11. **[MEDIUM] Kiosk config token is non-expiring and unrevocable per-device — leak exposes WiFi password + enables ring-spam DoS.** `apps/portal/lib/kiosk/config-token.ts:14` never checks `payload.t`; only kill switch is rotating the global secret. **Fix:** add a per-property `kiosk_token_version` to the signed payload, verified against the property row, so one device can be revoked; optionally enforce a max age on `t` and exchange the URL token for a stored short-lived token on first load.

12. **[MEDIUM] Kiosk `call-started` lets a leaked token mint unlimited RINGING VIDEO calls (agent ring-spam DoS).** `apps/portal/app/api/kiosk/call-started/route.ts:29` — no dedup/rate limit. **Fix:** reject if an active RINGING/IN_PROGRESS VIDEO call already exists for the property (one kiosk = one live call); add a per-token rate limit.

13. **[MEDIUM] Agora token route accepts a client-supplied `uid` — an already-privileged holder can join a live channel as an extra publisher.** `apps/portal/app/api/agora/token/route.ts:17`. **Fix:** allocate `uid` server-side — fixed guest uid for the kiosk branch, agent uid derived from `user.id` for the session branch; reject client-supplied `uid`.

14. **[MEDIUM] A leaked/crashed video call rings the agent's softphone for up to ~24h because the RINGING `incoming-video` query has no time bound and the reaper is daily-only on Hobby.** `apps/portal/app/api/calls/incoming-video/route.ts:27` (unbounded RINGING select) + `apps/portal/vercel.json` daily cron. **Fix:** add a staleness time-bound to the RINGING query (cheapest, kills the phantom ring) and/or an opportunistic read-path reap; tighten cron to `*/15` on Vercel Pro.

15. **[MEDIUM] VIDEO agent presence `ON_CALL` is overwritten to `AVAILABLE` by the softphone heartbeat mid-video-call.** `apps/portal/components/softphone/softphone.tsx:70` derives status from the audio phase only. **Fix:** have `/api/presence` refuse to downgrade `ON_CALL→AVAILABLE` when an IN_PROGRESS video call is `handled_by` this user, or share a presence signal between `VideoCallHost` and `Softphone`.

### Nice-to-have — LOW

16. **[LOW] Emergency conference control has no call-state guard and keys on stale `handled_by_user_id`.** `apps/portal/app/api/calls/[id]/emergency/control/route.ts:49`. **Fix:** require `state=IN_PROGRESS`; clear `handled_by_user_id`/`emergency_conference_name` on finalization. (Acts only on the agent's own leg — minor.)

17. **[LOW] Agora token session branch issues PUBLISHER tokens to any same-operator user, not just the handling agent.** `apps/portal/app/api/agora/token/route.ts:53`. **Fix:** add `call.handled_by_user_id === user.id` (or unassigned/RINGING for the answering flow), mirroring `emergency/control`.

18. **[LOW] `end-video` is operator-scoped but not handler-scoped — a peer agent can force-complete another's live call.** `apps/portal/app/api/calls/[id]/end-video/route.ts:45`. **Fix:** add `.eq("handled_by_user_id", user.id)` to the update, matching the notes route (keeps the reaper as the only cross-agent finalizer).

19. **[LOW] Twilio `/status` webhook clobbers the real `answered_at` with hang-up time on a callback-ordering race.** `apps/portal/app/api/twilio/voice/status/route.ts:56`. **Fix:** drop the `answered_at` write in `/status` (let `/answered` own it), or guard with `.is("answered_at", null)`.

20. **[LOW] `/status` can promote a never-answered call to COMPLETED with a fabricated `answered_at` if it wins the race against `/dial-result`.** `apps/portal/app/api/twilio/voice/status/route.ts:54`. **Fix:** only allow `status→COMPLETED` when the row is already `IN_PROGRESS`; let `/dial-result` own answered-vs-not.

21. **[LOW] `/status` returns 500 on internal error, inviting Twilio retries that re-write `ended_at`.** `apps/portal/app/api/twilio/voice/status/route.ts:64`. **Fix:** return 204/200 on caught error like the sibling webhooks; rely on the terminal-state guard + reaper.

22. **[LOW] Reaper finalizes leaked IN_PROGRESS calls without computing `duration_seconds` (NULL despite a known span).** `apps/portal/app/api/cron/reap-stale-calls/route.ts:36`. **Fix:** compute `round((ended_at-answered_at)/1000)` clamped ≥0 in the IN_PROGRESS branch, mirroring the two real-time finalizers.

23. **[LOW] Reaper IN_PROGRESS branch keys on `created_at`, force-closing a legitimately long (>30min) video call.** `apps/portal/lib/calls/reaper.ts:13`. **Fix:** key on `answered_at` when present (fall back to `created_at`), or raise the cutoff. (Emergency rows are AUDIO-only and already excluded.)

24. **[LOW] State machines enforced only as membership CHECKs — a future service-role route that forgets the predicate can move a terminal row backward.** `supabase/migrations/0001_init.sql:152`. **Fix:** add a BEFORE UPDATE trigger on `calls`/`incidents` rejecting transitions out of terminal states regardless of role, mirroring the 0010/0012 column-guard pattern.

25. **[LOW] Two conflicting definitions of "active" assignment; the unique index enforces only the `effective_until IS NULL` one.** `supabase/migrations/0005_assignment_one_active.sql:15` vs RLS `effective_until > now()` (`0004_fix_rls_recursion.sql:58`). **Fix:** normalize on `IS NULL` everywhere (drop the `> now()` branch from the RLS helper) or add a btree_gist EXCLUDE; latent until future-dated reassignment exists.

26. **[LOW] Password policy is 8-char only and Supabase leaked-password protection is disabled.** `apps/portal/lib/users/validate.ts:28`. **Fix:** enable leaked-password (HaveIBeenPwned) protection in the Supabase dashboard and raise the minimum to ≥12 / add a breach check.

27. **[LOW] Sentry scrubber is a narrow 2-key allowlist duplicated across both apps (drift risk).** `apps/portal/lib/sentry/scrub.ts:7`. **Fix:** move to one shared module, broaden by a key-name regex (`/token|secret|auth|signature|password|cookie/i`); no live leak today since `sendDefaultPii` defaults false.

28. **[LOW] Owner call-list orders by unindexed `ring_started_at`, forcing seq-scan + sort every 20s.** `apps/portal/app/(owner)/owner/calls/page.tsx:50`. **Fix:** change `ORDER BY` to the index-backed `created_at` (monotonic with `ring_started_at` at insert); no new index needed.

29. **[LOW] RLS quals re-evaluate `auth.uid()`/`current_user_role()` per row (`auth_rls_initplan`).** `supabase/migrations/0002_rls.sql:143`. **Fix:** wrap auth/SECURITY-DEFINER calls in scalar subselects — `(select auth.uid())` — across all policies so Postgres hoists to one InitPlan.

30. **[LOW] `AutoRefresh` + presence heartbeat fire on every window focus with no debounce.** `apps/portal/components/auto-refresh.tsx:11`. **Fix:** track `lastRefresh` in a ref and skip focus refresh within ~5s; apply to the softphone heartbeat focus handler too.

31. **[LOW] Bundle hygiene: `radix-ui` meta-package missing from `optimizePackageImports`; `VideoCall` wrapper statically imported; `next-themes` shipped though dark mode is cut.** `apps/portal/next.config.ts:10`, `components/video-call/video-call-host.tsx:5`, `components/ui/sonner.tsx:1`. **Fix:** add `experimental.optimizePackageImports: ['radix-ui','lucide-react']`; load `VideoCall` via `next/dynamic({ssr:false})`; hardcode `theme="light"` and drop `next-themes`.

32. **[LOW] Twilio Device / kiosk Agora glue is untyped (`any`) and untested — an SDK rename passes all 257 tests and only breaks on a live call.** `apps/portal/components/softphone/softphone.tsx:61`. **Fix:** use `@twilio/voice-sdk` exported `Device`/`Call` types; assert `callId` non-empty (Sentry breadcrumb) instead of `?? ""`; add a thin SDK-mock contract test.

---

## What's solid (don't touch)

- **Audio voice path finalization and idempotency.** Twilio status webhooks finalize AUDIO calls server-side, the multi-owner video finalization is state-guarded and first-writer-wins, and the reaper backstop is idempotent — the only gaps are the daily-cron cadence (a documented Hobby tradeoff) and the duration-compute omission, not the core state machine.

- **RLS and column-level write guards.** The skeptics independently confirmed RLS, `requireRole`, and the 0012 `profiles` column-guard trigger are all present and intact — the profiles self-escalation hole was already closed, the RLS-recursion pattern (`SECURITY DEFINER` helpers) is correct, and the emergency-control route demonstrates the project knows how to scope to the actual call-taker. Don't loosen these.

- **Twilio webhook HMAC verification and the apology-TwiML degradation path.** Signature validation is in place and the `incoming`/`dial-result` webhooks degrade gracefully on *thrown* errors (the only gap is *hung* dependencies, item 7).

- **Sentry PII scrubbing baseline.** `sendDefaultPii` defaults false, the codebase makes no `setExtra`/`addBreadcrumb` calls that stuff tokens into events, and a candidate "PII leak" was downgraded to a maintainability nit — no live cleartext-PII path exists.

- **Frontend weight discipline.** The genuinely heavy `agora-rtc-sdk-ng` is correctly lazy-loaded behind a dynamic import; remaining perf items are all trivial and forward-scale.

- **Emergency leg targeting.** The conference-control route correctly acts only on the agent's own leg (a candidate "can mute the 911 leg" finding was downgraded — the guest and PSAP legs are unreachable), and emergency rows are correctly AUDIO-channel-scoped and excluded from the video reaper.

---

## Appendix — corroborating prod signals (Supabase advisors, `ztunzdpmazwwwkxcpyfp`)

**Security advisors (all WARN):**
- `set_updated_at` has a mutable `search_path`.
- 7 `SECURITY DEFINER` functions executable by `anon` AND `authenticated` via `/rest/v1/rpc/*`: `current_user_operator_id`, `current_user_role`, `enforce_owner_incident_columns`, `enforce_owner_property_columns`, `enforce_profile_self_columns`, `user_is_assigned_to_property`, `user_owns_property`. (RLS-helper intent confirmed; verifiers found no data-leak path, but `EXECUTE` could be revoked from `anon` as defense-in-depth.)
- Leaked-password protection disabled in Supabase Auth (see action 26).

**Performance advisors:**
- Unindexed FKs: `admin_call_availability.operator_id`, `audit_logs.actor_user_id`, `incidents.triggered_by`, `property_assignments.backup_agent_id` + `operator_id`.
- `auth_rls_initplan` per-row re-eval on `profiles`/`admin_call_availability`/`properties`/`property_assignments`/`calls`/`incidents` (see action 29).
- Unused indexes: `profiles_operator`, `assignments_property`, `audit_entity`, `incidents_call`.
- Multiple permissive policies on `admin_call_availability`/`operator_settings`/`profiles`/`properties`/`property_assignments`.

All advisor items are LOW at current scale; fold the cheap ones (29, FK indexes) into the same migration that fixes action 5.
