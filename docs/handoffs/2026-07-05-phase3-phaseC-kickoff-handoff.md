# Handoff — Phase 3: Phase B DONE (prod smoke PASSED) → build Phase C (push productionized + duty controls) — START HERE

**Written:** 2026-07-05 (end of the Phase-B close-out session) · **Supersedes:** `2026-07-04-phase3-post-gates-handoff.md` · **Branch:** `phase3-workspace`, synced to `main` @ `f4af480` (Phase B is merged into `main`; the branch is even with it). **NOT a fresh branch — continue Phase C on `phase3-workspace`.**

## Where things stand

**Phase B (the whole A+B slice + fix loop) is COMPLETE and PROD-SMOKE VERIFIED.** Gates 3.0 (tile) + 3.1 (push ring) passed earlier on both of Kumar's machines. This session:

1. **Fix loop shipped** (subagent-driven, two-stage review, zero must-fix):
   - **Ring-silence control** — a Silence toggle on every ringing surface (agent `PropertyCard`, admin fleet cards, unmatched-ring fallback) that mutes the LOCAL audio ringer only; the card keeps ringing visually + stays answerable; auto-resets on the next ring. **Twilio finding (SDK-verified): `device.audio.incoming(false)` can't stop a LIVE ring** (the flag is read once when the call arrives) → the softphone now owns its own `/sounds/ring.mp3` element with the built-in ring disabled. Commit `b2d6513`.
   - **Kiosk catch-leak fix** — `onStartCall`'s setup-failure catch now closes the row it created (`endCall(id, "failed")`), so a post-create failure no longer leaves an answerable ghost ring that sticks `IN_PROGRESS` + 0016-blocks the property. New kiosk jsdom test harness. Commit `ac0a9b8`.
2. **PR #27** (A+B slice + fix loop) merged to `main` → prod.
3. **Prod two-call smoke PASSED (2026-07-05):** **audio full pass** (no double-ring, rang backgrounded, silence + answer-while-silenced); **video pass** (card rings, Answer connects to the kiosk, silence works). Details in the plan Task 10.
4. **Two smoke findings, both fixed on `main`:**
   - *Transient "Something went wrong" on the first video answer* = a post-deploy **ChunkLoadError** (open tab held a stale chunk map; the video overlay is lazy-loaded). **Self-healed**, not a code bug. **Carry-forward:** add a durable ChunkLoadError→reload guard (small, non-blocking) so a mid-shift deploy can't break an agent's next lazy-load.
   - *Video ring kept blaring ~30s AFTER answering* → **PR #28** (`f4af480`): the video ring now stops on the LOCAL answer (mirrors audio) — `useIncomingVideoCalls(operatorId, silencedKeys, activeCallId)` excludes the answered id from ring/tab-title/returned list; `waiting` is `useMemo`'d (the first cut render-looped → OOM the suite caught). Prod re-smoke by Kumar: **"rings stop the instant a call is answered."**

**Full suite green on `main`:** portal 545 node + 79 jsdom · kiosk 27 · typecheck · root lint · check:routes · both builds. VAPID keys already live in Vercel prod + Coolify staging (from Gate 3.1).

## NEXT SESSION, in order — build PHASE C (spec §6-C; plan `docs/plans/2026-07-04-phase3-workspace.md` Tasks 11-15)

Phase C = Web Push productionized + Go-on-duty / End-shift duty controls. **This is what closes the two "expected" smoke limitations** (backgrounded/off-home ringing → push wakes the tab + navigates home). Subagent-driven, house pattern (fresh implementer per task + two-stage review).

1. **Task 11 — migration `0019_push_subscriptions` + push send module + subscription route:**
   - `supabase/migrations/0019_push_subscriptions.sql` (subscription store + RLS). **Commit the SQL, then apply it: to STAGING via Supabase MCP (ref `cgtvqjxhbojztzumshca`) when built, AND to PROD (ref `ztunzdpmazwwwkxcpyfp`) at the Phase-C merge — the 0018 lesson: staging is back-applied by hand, never assume.**
   - After the migration: `pnpm gen:types` (needs local `supabase start` + **Supabase CLI 2.101.0**, the pinned version) and commit; CI's `gen:types:check` fails on drift. (First time gen:types is needed this phase.)
   - `apps/portal/lib/push/targets.ts` (per-property target users — the poll-side dial set) + `lib/push/send.ts` (web-push send + prune dead subscriptions) — TDD. `packages/shared/src/protocol.ts` gains `PUSH_TTL_SECONDS`.
   - `app/api/push/subscription/route.ts` (session-authed subscribe/unsubscribe via `requireApiActor`).
2. **Task 12 — production SW behaviors + client subscription manager + tab-ring wiring** (`lib/push/client.ts`; the SW `public/push-sw.js` skeleton from Phase A is extended, not rewritten).
3. **Task 13 — send-side wiring (push beside the broadcast in the kiosk `after()` hooks) + REMOVE the spike** (`/api/push-spike` + `push-spike-panel` + the spike UI). **The spike is temporary — Task 13 deletes it.**
4. **Task 14 — Go on duty + `DutyControls` card** (arms push + the softphone idle UI moves in). **Task 15 — End shift + fleet duty labels.**
5. Record a Phase-C smoke (push wakes a backgrounded/minimized tab and rings; notification click navigates home to the ringing card) → then Phase D (call tile), Phase E (remote access + Connect).

## Build gotchas / discipline (carried — load-bearing)

1. **⚠ DEP-HYGIENE — the dominant failure mode this session (hit TWICE):** any value a React effect depends on must be identity-stable when unchanged. (a) Publisher effects depend on the STABLE provider dispatchers, NEVER on the whole `surface` object. (b) **A hook that RETURNS an array which feeds a consumer's effect must `useMemo` it** — a fresh `.filter()`/`.map()` every render re-fires the effect → setState → re-render → infinite loop (the video-ring fix's first cut OOM'd the suite; the ring-silence prune uses the same discipline). The jsdom suite catches these as OOM / "Maximum update depth exceeded" — keep the loop-guard tests.
2. **`getNotifications({tag: ""})` returns ALL notifications** (WHATWG: empty tag bypasses the filter). The SW's call-cleared path is callId-guarded; **the production sender (Task 13) MUST send the same callId on clear as on incoming.**
3. **`IncomingRing.key` is channel-prefixed** (`audio:<callId>` / `video:<calls.id>`) — keep it for any new ring source; the silence set + the push payload key on it.
4. **Staging migrations lag prod:** back-apply via MCP (ref `cgtvqjxhbojztzumshca`) whenever prod ships a migration; check `supabase_migrations.schema_migrations` when staging behaves oddly. 0018 sat missing a week and silently killed staging realtime.
5. Still-live priors: **Claude cannot push `main` (PR; Kumar merges)** · pushing `staging`/`phase3-workspace` IS allowed · presence/`last_seen_at` writes stay service-role (0012 guard) · DocPiP `requestWindow()` synchronously inside the user gesture (Phase D, Task 16) · Coolify Traefik labels verbatim, no `$$` doubling.
6. **Subagent-driven build — do NOT skip the reviews to go faster.** This session's reviews + the TDD suite caught: the ring-silence loop (guarded), the video-ring OOM loop (caught + fixed), the SW empty-tag matches-all, and a kiosk dead-mock. Fresh implementer per task + two-stage review is load-bearing.
7. **The commit trailer this session used `Co-Authored-By: Claude Opus 4.8`** (the harness directive; prior commits used `Claude Fable 5`). Match whatever the active session's harness specifies.

## Carry-forward (non-blocking)

- **ChunkLoadError→reload guard** (from the video-answer smoke finding) — small durable hardening so a mid-shift deploy can't throw an agent's next lazy-loaded chunk (video overlay) to `global-error`. Not urgent (it self-heals), but real for an all-shift-open tab.
- **Phase 2 (RustDesk relay):** unchanged — waiting ONLY on Dilnoza's first clean full night → then run the Phase-2 close-out (tag `plan-phase2-relay-complete`, sync docs).
- **Phase 1 soak:** ~2026-07-10 checkpoint (verify the box/relay held a week unattended) → then close Phase 1 (tag `plan-phase1-box-staging-complete`). How-tos: `docs/setup/2026-07-02-box-ops-runbook.md`.
- Temp guest-audio diagnostics still on `main` (removal list: `docs/handoffs/2026-06-30-first-call-audio-debug-handoff.md` §4) · GitHub secret-scanning alert still open · pilot phone line not yet transferred (deliberate; Phase 3 lands first).

## Register reminder

Real dialogue, plain English, no pick-one menus — decide when one answer is sane; converse on genuine forks. Build for the future, not just the pilot. Sourcing discipline on every number/claim. **Systematic debugging before any fix (root cause first — this session that discipline turned "answer errors + ring won't stop" into two precise, separately-fixed root causes).** Nights run on proven infrastructure. Subagent-driven build with two-stage reviews — the reviews earn their keep.
