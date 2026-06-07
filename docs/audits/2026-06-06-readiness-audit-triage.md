# Lobby Connect — Readiness-Audit Triage (feature vs. bug)

**Date:** 2026-06-06
**Classifies:** every finding in `docs/audits/2026-06-06-readiness-audit.md`
**Method:** each finding was read against the actual code, the locked decisions and cut-from-v1
scope (`CLAUDE.md`), the relevant design spec (`docs/specs/`), the launch checklist
(`docs/setup/2026-06-03-launch-checklist.md`), and the v2 backlog (`docs/v2-backlog.md`).
**Output:** triage only — no code changed, no fix plan written.

## Buckets

| Bucket | Meaning |
|---|---|
| **BUG** | A real defect that contradicts the spec or a shipped feature. Should be fixed. |
| **INTENTIONAL TRADEOFF** | Working as designed; the behavior is a documented deliberate choice. |
| **DEFER-V2** | Relates to a feature/scale that v1 deliberately doesn't have yet. Re-surfaces post-pilot. |
| **ACCEPT-RISK** | A real-but-minor gap that is tolerable for the single-hotel pilot, usually already mitigated. |

Several findings split across buckets — the layer that contradicts intent is a BUG; the layer
that only matters at multi-agent / multi-property / multi-tenant scale is DEFER-V2 or ACCEPT-RISK.

## Summary tally

- **BUG (15):** 1, 2, 3, 4-A, 5-A, 7, 8, 15, 14-query, 16, 19, 20, 21, 22, 23
- **INTENTIONAL TRADEOFF (2):** 5-B, 14-cron
- **DEFER-V2 (4 + tails):** 4-B, 17, 18, 25 (+ deferred tails of 6, 11, 13)
- **ACCEPT-RISK (14 + advisors):** 6, 9, 10, 11, 12, 13, 24, 26, 27, 28, 29, 30, 31, 32 + all Supabase advisor items

The audit's "what's solid (don't touch)" list stands unchanged — none of it is reclassified here.

---

## BUG — fix these

Real defects contradicting spec or a shipped feature.

### Life-safety / 911 path (HIGH)

1. **Transient Supabase read error in the 911 re-join silently hangs up the guest into a dead
   conference.** `dial-result/route.ts:49`. The emergency design's purpose is reliably bridging the
   guest to a PSAP; a silent hangup on a transient blip violates that intent outright.

2. **Partial 911 dispatch failure strands the guest in a silent conference while the agent UI shows
   "911 active".** `emergency/route.ts:129`. The agent must know dispatch state to fall back (relay
   verbally / have the guest dial direct); a false "active" banner defeats the design.

3. **911 trigger is not idempotent — double-tap places two PSAP calls.** `emergency/route.ts:80`.
   Duplicate 911 calls are real-world harm; a TOCTOU oversight, never an intended affordance.

8. **No bounded timeout on the agent 911-escalation REST calls — the button can hang silently on
   the irreversible path.** `emergency/route.ts:113`. Same family as #7, on the life-safety path.

16. **Emergency conference control has no `state=IN_PROGRESS` guard and keys on a stale
    `handled_by_user_id`.** `emergency/control/route.ts:49`. Acts only on the agent's own leg, so
    blast radius is small — but it is a genuine missing-guard defect.

### Video-call authorization

4-A. **An OWNER can mint a PUBLISHER token and join a live guest video call.**
   `answer-video/route.ts:38`, `agora/token/route.ts` branch 2. The owner role is read-only
   (07a spec); a publisher token lets them appear, with A/V, inside a guest's live call — a direct
   contradiction of the owner-portal intent and a guest-privacy hole. **Fix is a 1-line owner
   reject.** (The matching `agent`-scope tightening is the deferred Layer B below.)

### Admin user management

5-A. **A failed hard-delete still writes the `user.deleted` audit row (phantom entry).**
   `users/actions.ts:235`. The audit-before-delete ordering corrupts the trail when the delete then
   fails. Move the audit write to *after* a successful delete, and fail gracefully with a "deactivate
   this user instead" message. (The FK block itself is intended — see 5-B.)

### Voice-path reliability

7. **No timeout/abort on Supabase/Twilio in the Twilio voice webhooks — a hung dependency gives the
   guest dead air.** `incoming/route.ts:49`. The path is meant to degrade to apology TwiML; it does
   on *thrown* errors but not on a *hung* one. Cheap `AbortSignal` fix.

15. **VIDEO agent presence `ON_CALL` is overwritten to `AVAILABLE` mid-video-call by the audio
    heartbeat.** `softphone.tsx:70`. Presence is meant to read `ON_CALL` during a call; deriving
    status from the audio phase only clobbers it (owner sees the wrong dot; can affect routing).

### Call finalization correctness (one cheap cluster)

14-query. **Unbounded RINGING `incoming-video` query lets a leaked video call keep ringing the
   agent.** `incoming-video/route.ts:27`. Adding a staleness time-bound kills the phantom ring on
   its own — independent of cron cadence (the daily-reaper half is an intentional tradeoff, 14-cron).

19. **`/status` clobbers the real `answered_at` with hang-up time on a callback-ordering race.**
    `status/route.ts:56`. Drop the `answered_at` write here (let `/answered` own it) or guard on
    `.is("answered_at", null)`.

20. **`/status` can promote a never-answered call to COMPLETED with a fabricated `answered_at`.**
    `status/route.ts:54`. Only allow `→COMPLETED` when the row is already IN_PROGRESS.

21. **`/status` returns 500 on internal error, inviting Twilio retries that re-write `ended_at`.**
    `status/route.ts:64`. Return 204/200 like the sibling webhooks; rely on the terminal-state guard.

22. **Reaper finalizes leaked IN_PROGRESS calls without computing `duration_seconds` (NULL).**
    `reap-stale-calls/route.ts:36`. Compute `round((ended_at-answered_at)/1000)` clamped ≥0.

23. **Reaper IN_PROGRESS branch keys on `created_at`, force-closing a legit >30min video call.**
    `lib/calls/reaper.ts:13`. Key on `answered_at` when present, or raise the cutoff.

---

## INTENTIONAL TRADEOFF — working as designed

5-B. **Hard-delete is blocked by RESTRICT FKs for a user who has history (handled calls, owns a
   property, etc.).** Intended: hard-delete is only for no-activity users (the v2-backlog documents
   "hard-delete the user, then invite fresh" as the bad-invite recovery); once a user has history,
   **deactivate (soft-delete)** is the correct tool. No `ON DELETE SET NULL` migration needed — the
   block stays; it just needs the graceful message from 5-A.

14-cron. **The stale-call reaper is daily-only.** Documented Hobby-plan cap (launch-checklist §4,
   `memory/build-quirks.md`). The `/status` thresholds are tuned to match. Flips to `*/15` on the
   two-line Vercel Pro move before public launch.

---

## DEFER-V2 — re-surfaces post-pilot

These only matter once there are multiple agents / properties / tenants — exactly what v1
deliberately doesn't have (locked decision #6: single-tenant, `operator_id` is the v1 boundary).

4-B. **An unassigned same-operator AGENT can join a live call** (`answer-video` + siblings). In a
   one-hotel pilot every authenticated agent is trusted staff of the one operator with one property.
   Scope AGENT to assigned/handling agent when multi-property/multi-agent lands.

17. **Agora token session branch issues PUBLISHER tokens to any same-operator user.**
   `agora/token/route.ts:53`. Same root as 4-B.

18. **`end-video` is operator-scoped, not handler-scoped — a peer agent can force-complete another's
   call.** `end-video/route.ts:45`. Trusted-staff/multi-agent concern; harmless at pilot scale.

25. **Two conflicting definitions of "active" assignment** (`effective_until IS NULL` vs
   `> now()`). `0005` vs `0004`. Latent until future-dated reassignment exists — a feature v1 lacks.

**Deferred tails of split findings:** automated E911-address validation (6), per-device kiosk-token
revocation (11), server-side Agora `uid` allocation (13).

---

## ACCEPT-RISK — tolerable for the pilot

Real but minor, usually already mitigated. Cheap ones can be folded in opportunistically.

6. **Emergency caller ID not verified against a registered E911 address.** `lib/emergency/dispatch.ts:23`.
   Mitigated in v1 by the *manual* E911-registration step (launch-checklist §2.2) on the one pilot
   number. Automated per-trigger validation → DEFER-V2.

9. **Cron routes fail-open if `CRON_SECRET` is unset.** `reap-stale-calls/route.ts:19`. Mitigated —
   the secret *is* set in prod. Making the Bearer check unconditional is a cheap correctness fix.

10. **`env.ts` validates only 4 of ~20 vars.** `lib/env.ts:16`. Nothing broken today (vars are set);
    boot-time validation is hardening, not a current defect.

11. **Kiosk config token is non-expiring / unrevocable.** `lib/kiosk/config-token.ts:14`. Gated by
    physical possession of the one tablet in v1. Per-device revocation → DEFER-V2.

12. **Kiosk `call-started` can mint unlimited RINGING video calls (ring-spam).**
    `kiosk/call-started/route.ts:29`. Gated by physical possession + one property. The "one kiosk =
    one live call" dedup is cheap and overlaps 14 — worth doing, not a blocker.

13. **Agora token route accepts a client-supplied `uid`.** `agora/token/route.ts:17`. Requires an
    already-privileged holder; compounds 4-B. Server-side uid allocation → DEFER-V2.

24. **Call/incident state machines are membership CHECKs only (no terminal-state trigger).**
    `0001_init.sql:152`. Defense-in-depth against a future service-role route; nothing broken today.

26. **Password policy is 8-char and leaked-password protection is off.** `lib/users/validate.ts:28`.
    Mitigated by invite-only provisioning. Enabling Supabase's leaked-password (HIBP) check is a
    1-click freebie worth doing.

27. **Sentry scrubber is a narrow 2-key allowlist duplicated across both apps.** `lib/sentry/scrub.ts:7`.
    No live leak (`sendDefaultPii` defaults false); maintainability nit.

28. **Owner call-list orders by unindexed `ring_started_at`.** `owner/calls/page.tsx:50`. ~0.8ms on
    26 rows; swap `ORDER BY` to the index-backed `created_at`. Forward-scale only.

29. **RLS quals re-evaluate `auth.uid()`/`current_user_role()` per row** (`auth_rls_initplan`).
    `0002_rls.sql:143`. Forward-scale; wrap in `(select auth.uid())` whenever convenient.

30. **`AutoRefresh` + heartbeat fire on every window focus with no debounce.** `auto-refresh.tsx:11`.
    Negligible at pilot scale.

31. **Bundle hygiene** — `radix-ui` missing from `optimizePackageImports`, `VideoCall` statically
    imported, dead `next-themes` dep. `next.config.ts:10` etc. Trivial.

32. **Twilio/Agora glue is untyped (`any`) and untested.** `softphone.tsx:61`. Regression risk gated
    by manual prod smoke-testing; add SDK types + a contract test when touched.

### Supabase advisors (appendix) — all ACCEPT-RISK

All LOW at current scale (1 operator, 26 calls); none changes behavior today.

- `set_updated_at` mutable `search_path` → pin `search_path` (defense-in-depth).
- 7 `SECURITY DEFINER` helpers executable by `anon`/`authenticated` → verifiers found **no**
  data-leak path; revoke `EXECUTE` from `anon` as hardening.
- Leaked-password protection disabled → same as 26.
- Unindexed FKs / `auth_rls_initplan` / unused indexes / multiple permissive policies → forward-scale
  perf; fold the cheap ones into one migration whenever convenient.

---

## What this means for launch

The fix-then-ship gate from the audit is unchanged, but now bucketed:

- **Must fix before pilot:** the BUG list — and within it the life-safety 911 items (1, 2, 3, 8, 16)
  and the owner-video-privacy 1-liner (4-A) are the true blockers.
- **Fix opportunistically (cheap, low-risk):** the finalization-correctness cluster (14-query,
  19–23), presence (15), voice-webhook timeout (7), and the 1-click freebies (9, 26).
- **No action for v1:** the INTENTIONAL TRADEOFF, DEFER-V2, and ACCEPT-RISK buckets — re-surface
  the DEFER-V2 items in `docs/v2-backlog.md` as the pilot proceeds.
