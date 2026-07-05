# Handoff — Phase 3: Gates 3.0 + 3.1 PASSED · staging smoke debugged · Agora-cert-on-staging DECLINED (LiveKit next) · fix loop → PR → PROD smoke (START HERE)

**Written:** 2026-07-04 (end of the gates + staging-debug session) · **Supersedes:** `2026-07-04-phase3-build-gates-handoff.md` · **Branch:** `phase3-workspace` @ `ce422a2` + this handoff commit (pushed) · **NOT merged to `main`** · staging box runs image `33c8731` = the A+B build (commits since are docs-only; no staging redeploy needed).

## Where things stand

1. **GATE 3.1 (push ring) = FULL PASS, both machines, 2026-07-04. Phase C is GO; Plan B (all-shift keepalive tile) is retired.**
   - **Mac** ~15:14 CDT: 15s/60s/360s pushes all received tab-hidden; client-clock latencies 0.4/0.5/0.7s; the 360s **box delayed send** fired exactly on schedule (the case Vercel cannot run).
   - **Windows PC** ~17:53 CDT: same drill clean; 0.4/0.4/0.6s.
   - **Cross-proof on BOTH machines:** the concurrently-open tile-prototype tab logged **max tick gap 60.0s (THROTTLED)** during each 360s wait — the push still arrived sub-second. Push wake is independent of tab throttling: the pivot's core thesis, now proven on both OSes. Results stamped in plan Task 3 (RESULT block, `2380a1a`).
   - Product finding (Kumar, after a ring he couldn't take rang out full-length): **a ring-SILENCE control is required** on agent + admin ringing surfaces. Spec'd below; queued in the fix loop.
2. **Phase-B staging smoke: the video-CONNECT beats are WAIVED on staging (Kumar's decision).** Attempt 1 (~18:30 CDT) hit a 3-layer **staging-environment** failure — systematically debugged, fully understood, **NOT the new Phase-B code**:
   - **`AGORA_APP_CERTIFICATE` is missing on the Coolify staging portal** (`AGORA_APP_ID` present; VAPID trio present — why Gate 3.1 worked). `getAgoraCredentials()` throws → `/api/agora/token` 500 → the kiosk bails to the apology screen seconds AFTER `startCall()` created the row. **DECISION (Kumar): do NOT add the cert to staging** — LiveKit replaces Agora in Phase 4 ("we'll have plenty of opportunities to run these tests after switching"). Staging video-connect testing resumes post-LiveKit.
   - **Latent kiosk bug (on prod `main` too):** `onStartCall`'s catch (`apps/kiosk/src/App.tsx` ~line 149) tears down + apologizes but **never closes the row it created** → a live, answerable ghost ring under an apology screen. Kumar answered one from the admin account; the overlay's own token fetch also 500'd; the row stuck IN_PROGRESS and **0016's one-active-per-property index correctly 409'd every later tap** (kiosk throws on any non-OK → instant apology, zero rings). Cleared reaper-style via MCP (FAILED + real duration); admin presence self-corrected on the next heartbeat (S3 inference verified live). Fix spec'd below.
   - **Migration 0018 had never been applied to staging** (staging built 06-21; v1.2/0018 shipped 06-28) → the realtime subscribe was authz-denied → rings surfaced only via the 60s fallback poll / refetch-on-focus ("rang only after I switched tabs"). **0018 NOW APPLIED to staging via MCP.**
   - What attempt 1 DID prove live: **the new PropertyCard rang on staging** (late, pre-0018) — the publisher→provider→card pipeline works in a real browser, not just jsdom.
3. **Phase 2 (relay):** unchanged — waiting ONLY on Dilnoza's first clean full night. **Phase 1:** soak checkpoint ~2026-07-10. Checklists below, carried verbatim.

## NEXT SESSION, in order

1. **Fix loop on the branch** (subagent-driven, house pattern — fresh implementer + two-stage review):
   - **(a) Ring-silence control** — on every ringing card (agent PropertyCard, admin FleetBoard card, AND the unmatched-ring fallback card): mutes the **local ringer only** for that ring key; the card keeps ringing visually and stays answerable (for this user and everyone else); auto-resets on the next ring. Mechanics: a `silenceRing(key)` dispatcher on `CallSurfaceProvider`; the **publishers** own their ringtone elements (softphone audio ring / video-host ring) and honor the silenced key set. ⚠ DEP-HYGIENE: publisher effects depend on the stable dispatchers, never on `surface`. The Phase-D call tile inherits the same control.
   - **(b) Kiosk catch-leak fix** — in `onStartCall`'s catch: `if (callIdRef.current) void endCall(callIdRef.current, "failed");` (mirrors the existing terminal-connection path). Regression test: `startCall` resolves + token fetch rejects → `endCall` called with `"failed"`. This also makes staging kiosk taps self-clean despite the missing cert.
2. **Open the PR to `main`** — the whole A+B slice + fix loop (Claude cannot push `main`; PR per the #26 precedent). Kumar merges → Vercel auto-deploys prod.
3. **PROD smoke = the real Phase-B verification** (prod has full Agora + Twilio; this replaces the waived staging half):
   - Kiosk video call → agent's property card expands + rings mint → **Answer** → today's full-screen overlay **with the guest actually connected** → End.
   - Phone call → audio card rings → Answer → audio overlay. (First live audio-card exercise — staging never could.)
   - Admin: covering OFF = ring visible, no Answer; ON = Answer works; toggle round-trips a reload.
   - Race: two browsers ringing, one answers → loser's card stops (409 claim path).
   - Try **Silence** on a live ring. Feel out **DECLINE-GONE** (cards = Answer + Connect only; unanswered rings time out at 120s).
   - Expectation: rings are near-instant on foreground/recently-focused tabs (realtime); **fully-backgrounded ringing stays best-effort until Phase C** — that is precisely what Phase C ships.
   - Hygiene: **End every answered call** — an answered-but-abandoned call 0016-blocks its property for up to 30 min.
4. Record results in plan Task 10 → **Phase C build** (Task 11 first: migration **0019 push_subscriptions** + `lib/push/targets.ts`/`send.ts` + subscription route). Apply 0019 to **staging via MCP when built** AND to prod at the Phase-C merge — the 0018 lesson: staging is back-applied by hand, never assume.
5. If Kumar reports **Dilnoza's clean night** → run the Phase-2 close-out (below) on the spot. On/after ~2026-07-10 → the July-10 soak checklist (below).

## Build gotchas (carried — load-bearing)

1. **Publisher effects must depend on the STABLE dispatchers, never on `surface`** (the whole context value) — depending on it loops ("Maximum update depth exceeded"). Loop-guard test enforces it; marked ⚠ DEP-HYGIENE in plan + code. Applies to the silence control (1a above), Task 14's duty controls, Task 17's tile controls.
2. **`getNotifications({tag: ""})` returns ALL notifications** (WHATWG: empty-string tag bypasses the filter). The SW's call-cleared path is callId-guarded; the production sender (Task 13) MUST send the same callId on clear as on incoming.
3. **Root `pnpm lint` (`eslint .`) is the CI gate** and lints more than per-package `-F` lint. Always run ROOT lint before calling a task done.
4. **Gate 3.1's delayed-send only fully works on box staging** (serverless can't sleep 360s; prod pushes are immediate on kiosk call-started).
5. **`IncomingRing.key` is channel-prefixed** (`audio:<callId>` / `video:<calls.id>`) — keep it that way for any new ring source; the silence set keys on it.
6. **A ring must never be audible but unanswerable** — preserve the unmatched-ring fallback card in any grid work; it gets the Silence control too.
7. **The spike surface (`/api/push-spike` + panel) is TEMPORARY** — deleted in Task 13. `/duty-tile-prototype` dies in Task 21 (keep `lib/duty-tile/pip-document.ts`).
8. Still-live priors: Claude cannot push `main` (PRs; pushing `staging` IS allowed and auto-deploys the box) · DocPiP `requestWindow()` synchronously inside the user gesture (Task 16) · Coolify Traefik labels verbatim, no `$$` doubling · presence writes stay service-role (0012 guard) · `pnpm gen:types` needs local `supabase start` + CLI 2.101.0 (first needed at Task 11).
9. **NEW — staging migrations lag prod:** back-apply via MCP (ref `cgtvqjxhbojztzumshca`) whenever prod ships a migration; 0018 sat missing for a week and silently killed realtime rings on staging. Check `supabase_migrations.schema_migrations` when staging behaves oddly.
10. **NEW — staging box access:** containers `lg2rzpmc…`=portal(:3000) · `ziqzypp2…`=kiosk · `su8p4jpn…`=ops; image tags carry the deployed SHA. `ssh -i ~/.ssh/lc_box root@159.203.124.112` works from Kumar's network (SSH is IP-firewalled to it).
11. **NEW — staging kiosk taps cannot complete video** (no Agora cert, by decision): they ring the cards, then the kiosk apologizes. **Don't Answer them** — an answered call can never connect and 0016-blocks the property (RINGING reaps at 10 min, IN_PROGRESS at 30 min, cron `*/15`; or finalize reaper-style via MCP). The catch-leak fix (1b) makes future taps self-clean.

## Close Phase 2 (the moment Kumar confirms Dilnoza's clean night) — carried verbatim

1. Migration plan Phase-2 STATUS block: prepend **DONE (real night <date>)**; tick the done-when checkbox.
2. `git tag plan-phase2-relay-complete && git push --tags`.
3. Sync CLAUDE.md current-focus + `MEMORY.md` + `memory/project-status.md` + auto-memory (one line each).
4. If the night was NOT clean: runbook §12 incident steps (logs → ports → fallback swap), debug with the soak untouched.

## The July-10 checkpoint: VERIFY THE SOAK HELD (on/after ~2026-07-10) — carried verbatim

How-tos in the runbook (`docs/setup/2026-07-02-box-ops-runbook.md`); ~7 soak days expected. Includes the relay.
1. **Box:** `doctl compute droplet get 581936683 --format Name,Status` = active · SSH `uptime` (no reboot outside the 17:00 UTC patch window) · `df -h /` (<20%).
2. **Coolify scheduled tasks** (app `su8p4jpng7izpzl7e7sw4k8o`): reaper ≈96/day all success · presence 1/day · prod-pg-dump 1/day.
3. **Dumps:** `ls /data/lc-backups/` — one per night, oldest pruned at 14.
4. **Staging Supabase did NOT auto-pause:** MCP `execute_sql` on `cgtvqjxhbojztzumshca` works; `health_signals.cron_reap_stale_calls.last_ok_at` within 15 min.
5. **Front door:** portal + kiosk anon → 401 Basic; `/api/kiosk/config` → app-4xx without a Basic challenge.
6. **Relay:** hbbs/hbbr both Up, same `Key:` lines, no `Authentication failed` flood (runbook §12 health check).
7. **Kumar:** no DO alert emails; agent/owner dashboards eyeballed on staging.
**All green → close Phase 1:** stamp `STATUS: DONE` in the migration plan Phase-1 section · tag `plan-phase1-box-staging-complete` + push tags · sync docs.

## Carry-forward hygiene (non-blocking)

Temp guest-audio diagnostics still on `main` (removal list: `docs/handoffs/2026-06-30-first-call-audio-debug-handoff.md` §4) · GitHub secret-scanning alert still open · pilot phone line NOT yet transferred (deliberate; Phase 3 lands before phone volume) · Vercel CLI outdated (52.2.1 → 54.x, harness nags; harmless).

## Register reminder

Real dialogue, plain English, no pick-one menus — gate debriefs are conversations. Decide-don't-menu when one answer is sane. Build for the future, not just the pilot. Sourcing discipline on every number. Nights always run on proven infrastructure. Subagent-driven build: fresh implementer per task, two-stage review, fix agents on findings — the reviews caught three real defects last session and the staging debug caught a fourth (the kiosk catch-leak); do not skip them to go faster.
