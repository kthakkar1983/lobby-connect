# Handoff — Phase-3 build: Phases A+B CODE-COMPLETE, at Kumar's TWO staging gates (Gate 3.1 push drill + Phase-B ring-on-card smoke) (START HERE)

**Written:** 2026-07-04 (~end of the plan-gate + build session) · **Supersedes:** `2026-07-04-phase3-spec-gate-handoff.md` · **Branch:** `phase3-workspace` @ `d966070` (pushed; `staging` branch fast-forwarded to the same SHA → box auto-deployed) · **NOT merged to `main`** — the PR rides both gates passing.

## Where things stand

1. **Phase 3 — spec GATED, plan GATED (with one edit), build running subagent-driven; Phases A+B done.**
   - **Spec** `docs/specs/2026-07-04-phase3-workspace-design.md` APPROVED with D12 (Connect from in-call surfaces) folded in (`c3eda73`); blaze stance settled (blaze stays, sparing, non-emergency; red = 911 only).
   - **Plan gate edit (Kumar): HOLD DEFERRED ENTIRELY** ("push it to when we have more than one property") → plan is now **21 tasks / 5 phases** (`35f0d9e`); hold's full 6c-conference design recorded in spec §3.6 for the multi-property moment (likely rides Phase 4/LiveKit). With hold out, **nothing in Phase 3 touches dial-result or the 911 route** — the only voice-path change shipped is Task 4's additive `propertyId` TwiML `<Parameter>` (dedicated byte review: dial semantics byte-identical).
   - **Plan** `docs/plans/2026-07-04-phase3-workspace.md` — migrations renumbered to ship order: **0019 `push_subscriptions` (Phase C, NOT YET WRITTEN), 0020 `property_remote_access` (Phase E)**. No migration has shipped yet — Phases A+B are migration-free.
   - **Build method:** superpowers:subagent-driven-development — fresh implementer per task + two-stage review (spec, then quality; combined for tiny tasks), fix agents on findings, re-review to verdict. It has EARNED its cost this session (see gotchas: three real defects caught pre-merge).
2. **Phase 2 (RustDesk relay)** — still waiting ONLY on Dilnoza's first clean full night ("have not run a full night shift yet", Kumar 2026-07-04). Close-out checklist below, carried verbatim.
3. **Phase 1 — SOAK RUNNING** to ~2026-07-10, passive. July-10 checklist carried below.

## The build so far (Tasks 1–9 all closed through review; 545 node + 67 jsdom tests; root lint/typecheck/build/check:routes green)

| Task | What | Commits (main ones) |
|---|---|---|
| 1 | `web-push@3.6.7` + `lib/push/vapid.ts` (call-time env reader) | `3e34702` |
| 2 | `public/push-sw.js` (PERMANENT skeleton) + `lib/push/sw-registration.ts` + temporary spike route `/api/push-spike` + panel on `/duty-tile-prototype` + `.env.example` VAPID block | `553d274` + fixes `c57e243`/`43590f3` |
| 4 | Additive `propertyId` `<Parameter>` in `lib/voice/twiml.ts` + incoming route call site | `1378b25` (byte review PASS) |
| 5 | `lib/dashboard/pods.ts` — groupPodsByAgent / cardLiveState / dutyLabel (TDD) | `b7358da` + ghost-agent hardening `33d1e3e` |
| 6 | `components/dashboard/call-surface-provider.tsx` (the phase's client seam) wrapped in app-shell | `b3fba25` (+ plan fix `c955d8d`, lint fix `1e46bbf`) |
| 7 | Softphone + video host PUBLISH into the provider; `lib/hooks/use-incoming-video-calls.ts` (banner logic verbatim); `IncomingVideoBanner` deleted; loop-guard test | `fa48f76` + minors `e768227` |
| 8 | `components/dashboard/property-card.tsx` + `pod-card-grid.tsx` + agent "Your pod" grid (old ChannelBar pod card removed); `isTodayInZone` extracted | `2be067b` + unmatched-ring fallback `fd36bb2` |
| 9 | `components/dashboard/fleet-board.tsx` — admin pod-grouped fleet REPLACES the ops table; Covering toggle on cards; Answer covering-gated; `IncomingCallToast` deleted | `d966070` |

**VAPID keys:** generated this session; **LIVE in Vercel production env** (all three) + `apps/portal/.env.local` (gitignored). **Kumar set them in Coolify staging + redeployed ("setup stage done. env updated").** Private key → PM vault (from `.env.local`) if not already done.

## NEXT SESSION, in order

1. **Collect Kumar's two gate results** (checklists below — he ran them after sleeping).
   - **Gate 3.1 PASS + Phase-B smoke clean** → open the **PR to `main`** for the whole A+B slice (Claude cannot push `main`; PR per the #26 precedent), Kumar merges → **prod smoke** (repeat the Phase-B checklist on prod; the spike's 15s/60s buttons work on Vercel, the 6m one times out by design) → then **Phase C build** (Task 11 first: migration 0019 + `lib/push/targets.ts`/`send.ts` + subscription route — apply 0019 to staging via MCP `cgtvqjxhbojztzumshca` when built, to prod `ztunzdpmazwwwkxcpyfp` at the Phase-C merge).
   - **Gate 3.1 FAIL** → STOP Phase C; the recorded Plan B (all-shift keepalive tile, Gate 3.0-proven) replaces the push design — re-plan Phase C around it with Kumar before building. Phase B ships regardless (it doesn't depend on push).
   - **Phase-B smoke issues** → fix loop on the branch (subagent per fix), re-smoke, then PR.
2. If Kumar reports **Dilnoza's clean night** → run the Phase-2 close-out (below) on the spot.
3. On/after ~2026-07-10 → run the July-10 soak checklist (below).

## Gate 3.1 — push-ring drill (Kumar, both machines, staging)

At `staging.lobby-connect.com/duty-tile-prototype`, "Gate 3.1 — push ring" panel (Windows PC first, then Mac; Chrome):
1. **Subscribe + prime audio** → accept the notification permission prompt.
2. **Push in 15s** → minimize browser, RustDesk fullscreen → expect loud ring within seconds of the mark + OS toast.
3. **Push in 60s** → same. 4. **Push in 6m** → the intensive-throttling case (only works on box staging — Vercel times out by design).
5. Click a toast once → portal focuses (observed, not gating). 6. **Copy report** → paste back.
- **Trust the "(client clock)" latency number** (the cross-clock one is informational; negative = clock skew, expected).
- **PASS** = loud ring within a few seconds on every drill, both machines. **FAIL** → Plan B (all-shift tile) per above.

## Phase-B smoke (Kumar, staging: agent + admin)

1. **Agent home**: "Your pod" card grid is the first card (right-rail incoming block, persistent Video card, off-home toast ALL GONE). Kiosk video call → property card **expands + rings mint** (channel + elapsed ticking) → **Answer** → today's full-screen overlay unchanged. Repeat with a phone call (audio card ring).
2. **Admin home**: ops table replaced by pod-grouped **FleetBoard** (agent headers: presence dot + duty label + count; "Unassigned" trails). Covering OFF → ring visible, NO Answer; ON → Answer works. Covering toggle **round-trips** (flip, reload, persisted).
3. **Race**: two browsers ringing, one answers → loser's card stops (409 claim path).
4. Review-flagged eyeballs: Covering toggle layout inside the card footer (first time outside a table cell) · multi-pod vertical rhythm · phone-health tile still shows "needs attention" counts (relocated from the table, not lost) · presence dots tick every 60s (minutes-scale staleness is fine).
5. **Deliberate product change to feel out: DECLINE IS GONE** (cards carry Answer + Connect only, per spec D1; the softphone incoming block that housed Decline is retired; `declineCall` removed as dead code). An unanswered ring times out via the normal 120s window. If Kumar misses a "silence this ring" affordance → small add-back, note for the fix loop.

## Build gotchas from this session (carry these — they're load-bearing)

1. **Publisher effects must depend on the STABLE dispatchers, never on `surface`** (the whole context value) — registering a handler changes the value; depending on it loops ("Maximum update depth exceeded"). The plan's Task-7 snippets were corrected (`c955d8d`); a loop-guard test now enforces it. Any future publisher (Task 14's duty controls, Task 17's tile controls) MUST follow the same rule — it's marked ⚠ DEP-HYGIENE in the plan + code comments.
2. **`getNotifications({tag: ""})` returns ALL notifications** (WHATWG: empty-string tag bypasses the filter — the intuitive "matches nothing" is WRONG). The SW's call-cleared path is callId-guarded; the production sender (Task 13) MUST send the same callId on clear as on incoming.
3. **Root `pnpm lint` (`eslint .`) is the CI gate and lints more than the per-package `-F` lint** (which scopes to app/components/lib) — the SW's `self` globals needed an `eslint.config.mjs` block (`apps/portal/public/**/*.js`). Always run ROOT lint before calling a task done.
4. **Gate 3.1's delayed-send only fully works on box staging** — a serverless function can't sleep 360s (`/api/push-spike` has `maxDuration=60`; the clamp comment explains). Prod never needs delayed sends (real pushes fire immediately on kiosk call-started).
5. **`IncomingRing.key` is channel-prefixed** (`audio:<callId>` / `video:<calls.id>`) for cross-channel uniqueness — keep it that way when new ring sources appear.
6. **A ring must never be audible but unanswerable** — the unmatched-ring fallback card (in `pod-card-grid.tsx`, hoisted to board level in FleetBoard via `UnmatchedRingCards` + `showUnmatchedRings={false}` per-pod) catches null/out-of-pod propertyIds. Preserve it in any future grid work.
7. **The spike surface (`/api/push-spike` + `push-spike-panel.tsx` + panel mount) is TEMPORARY** — deleted in Task 13. `/duty-tile-prototype` itself dies in Task 21 (keep `lib/duty-tile/pip-document.ts` — the call tile reuses it).
8. Still-live priors: Claude cannot push `main` (PRs; pushing `staging` IS allowed and auto-deploys the box) · DocPiP `requestWindow()` synchronously inside the user gesture (Task 16) · Coolify Traefik labels verbatim, no `$$` doubling · presence writes stay service-role (0012 guard) · `pnpm gen:types` needs local `supabase start` + CLI 2.101.0 (first needed at Task 11).

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

Real dialogue, plain English, no pick-one menus — gate debriefs are conversations. Decide-don't-menu when one answer is sane. Build for the future, not just the pilot. Sourcing discipline on every number. Nights always run on proven infrastructure. Subagent-driven build: fresh implementer per task, two-stage review, fix agents on findings — do not skip reviews to go faster; they caught three real defects this session.
