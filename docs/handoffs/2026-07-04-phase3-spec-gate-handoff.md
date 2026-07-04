# Handoff — Phase-3 spec written, at Kumar's review gate (push-first alerting + call-scoped tile); Phase-2 real-night stamp + July-10 soak checkpoint pending (START HERE)

**Written:** 2026-07-04 (~06:45 UTC, end of the Gate-3.0 + Phase-3-brainstorm session) · **Supersedes:** `2026-07-03-phase3-kickoff-handoff.md` · **Branch:** `phase3-workspace` (spec + doc amendments committed `72b7003`, pushed; NOT merged — merge rides Kumar's spec approval)

## Where things stand (three threads, two passive)

1. **Phase 3 — Gate 3.0 PASSED, brainstorm DONE, SPEC WRITTEN — awaiting Kumar's review gate.**
   - **Gate 3.0 (deskphone-tile prototype):** built same-day on `phase3-gate-tile-prototype`, judged on staging first (Kumar's call — "not straight to prod"), then merged via PR #26 (`ba1b828`) → prod route `/duty-tile-prototype`. **PASSED on BOTH OSes:** Kumar's Mac (2026-07-03 ~23:52 CDT) + Kumar's **Windows PC** (2026-07-04 ~00:48 CDT) — 1s-tick max-gap ≤1.1s with the browser **minimized**, rings 0.0s late incl. a **360s ring** (past Chrome's intensive-throttling window), tile stayed on top of **fullscreen RustDesk running SynXis during a real guest check-in**, ring audio never blocked (the prototype logs visibility transitions + silent-ring detection — `7fddcad`). Thin-desktop-shell escalation **retired**. Dilnoza's own run = optional/informational now.
   - **The brainstorm pivoted the design (Kumar):** the all-shift tile "solve[d] two problems at once." Separation: **(P1) always-rings = push-first signal with an AUDIBLE contract** ("as long as they can hear it ring… they can always switch quickly to the lc tab and answer from the dashboard" — answer-from-toast NOT required) · **(P2) the floating tile is CALL-SCOPED** — opens on the Answer gesture, guest-video-first (eye contact with the kiosk guest while working RustDesk), dies at hang-up.
   - **Spec: `docs/specs/2026-07-04-phase3-workspace-design.md`** — decision log **D1–D11** (dashboard-first card answering with in-place expansion; today's in-call overlays UNTOUCHED; slim "Go on duty" = prime audio + push permission; **"End shift" button** → immediate service-role OFFLINE; no shift schedule (v2 seam); second-ring-answers-holds; **hold = UI + AUDIO only in P3, video-hold wiring = Phase 4/LiveKit** (Kumar's correction — no Agora plumbing); Connect per-need + pre-warm at Answer; admin fleet pod-grouped, Answer gated by `covering`, Connect never gated) · migrations **0019 `property_remote_access`** + **0020 `push_subscriptions`** · **Gate 3.1 (push-ring spike) = FIRST build task** (§5: pass = loud ring within seconds, browser minimized behind fullscreen RustDesk, both machines; toast observed, not gating; fail → all-shift tile returns as recorded Plan B) · build order §6 (gate → cards → push → tile → remote-access → hold-audio, each staging-first).
   - Same commit amended the **migration plan Phase-3 bullets + done-when** and marked the **target spec §5 all-shift framing superseded** — no doc still claims the old design.
2. **Phase 2 (RustDesk relay) — ONLY the real-night gate pending.** All infra + 4 clients done 2026-07-03 (Dilnoza direct-P2P; admin "snappy" via hbbr; 0 auth failures). The night of Jul 3→4 US was a candidate — **ask Kumar whether Dilnoza's night was clean**; close-out checklist below.
3. **Phase 1 — SOAK RUNNING** to ~2026-07-10, passive. Checklist below. Prod (Vercel + Twilio + Agora) untouched by everything above.

## Next session, in order

1. **Kumar's spec verdict** (`docs/specs/2026-07-04-phase3-workspace-design.md`). Apply his edits, re-commit. Register reminder: real dialogue, no menus.
2. On approval → **invoke superpowers:writing-plans** → `docs/plans/2026-07-04-phase3-workspace.md` following spec §6 (Gate 3.1 first; TDD'd pure helpers; subagent-driven build per house pattern; hold LAST with 911-grade byte review). Then build.
3. Gate 3.1 needs **VAPID keys** (generate at build; public key to both envs, private to Vercel env — Vercel CLI is authed) and extends/siblings the existing `/duty-tile-prototype` page. Kumar re-runs the Gate-3.0 drill (Windows PC + Mac, minimized browser, fullscreen RustDesk).
4. Merge path: `phase3-workspace` → PR when Kumar approves (direct pushes to `main` are permission-blocked for Claude — PRs or Kumar merges; PR #26 precedent).

## Close Phase 2 (run the moment Kumar confirms Dilnoza's clean night) — carried verbatim

1. Migration plan Phase-2 STATUS block: prepend **DONE (real night <date>)**; tick the plan's done-when checkbox.
2. `git tag plan-phase2-relay-complete && git push --tags`.
3. Sync CLAUDE.md current-focus + `MEMORY.md` + `memory/project-status.md` + auto-memory (one line each: Phase 2 DONE).
4. If the night was NOT clean: runbook §12 incident steps (logs → ports → fallback swap), debug with the soak untouched.

## The July-10 checkpoint: VERIFY THE SOAK HELD (on/after ~2026-07-10, whatever else is in flight) — carried verbatim

How-tos in the runbook; ~7 soak days expected. Includes the relay.

1. **Box:** `doctl compute droplet get 581936683 --format Name,Status` = active · SSH `uptime` (no reboot outside the 17:00 UTC patch window) · `df -h /` (<20%).
2. **Coolify scheduled tasks** (app `su8p4jpng7izpzl7e7sw4k8o`): reaper ≈96/day all success · presence 1/day · prod-pg-dump 1/day.
3. **Dumps:** `ls /data/lc-backups/` — one per night, oldest pruned at 14.
4. **Staging Supabase did NOT auto-pause:** MCP `execute_sql` on `cgtvqjxhbojztzumshca` works; `health_signals.cron_reap_stale_calls.last_ok_at` within 15 min.
5. **Front door:** portal + kiosk anon → 401 Basic; `/api/kiosk/config` → app-4xx without a Basic challenge.
6. **Relay:** hbbs/hbbr both Up, same `Key:` lines, no `Authentication failed` flood (runbook §12 health check).
7. **Kumar:** no DO alert emails; agent/owner dashboards eyeballed on staging.

**All green → close Phase 1:** stamp `STATUS: DONE` in the migration plan Phase-1 section · tag `plan-phase1-box-staging-complete` + push tags · sync CLAUDE.md/MEMORY/project-status. Any red → runbook §8 first.

## Gotchas worth carrying (new this session + still-live priors)

1. **Claude cannot push to `main`** (permission classifier; prod auto-deploys from it) — use PRs / Kumar merges. Pushing `staging` IS allowed (Coolify auto-deploys the box staging on push — runbook §5).
2. **DocPiP `requestWindow()` must be called synchronously inside the user gesture** — in the Answer handler, open the window FIRST, then run the async accept flow (Gate-3.0 build constraint, spec §8.4).
3. **Chrome's PiP window chrome is browser-drawn and ambiguous** — Kumar pressed "Back to tab" expecting maximize. Accidental closes are real → the overlay carries a "reopen tile" affordance (spec §3.3).
4. **Blaze-vs-coral palette stance:** Kumar said "we did away with blaze" — factually CORAL was retired; blaze (`--color-attention`) is the live attention token (globals.css + brand guidelines). Rings are LIVE events → mint-on-navy (never blaze/red). **Settle the blaze stance with him before the cards ship** (incident chips use blaze).
5. **Gate-3.0 prototype route `/duty-tile-prototype` is live on prod** — temporary; remove/supersede during the P3 build (Gate 3.1 may extend it first).
6. **Visual-companion sessions** live under gitignored `.superpowers/brainstorm/`; server auto-exits after 30 idle minutes (restart via the skill's `start-server.sh`; new port each time). The final screens predate the pivot — the spec is authoritative.
7. Relay/box priors (still live): Coolify passes Traefik labels **verbatim** (no `$$` doubling) · Next build imports API route modules (build-stage service-key dummy) · hbbs DNS-resolves `-r` at startup and silently drops failures (`extra_hosts` + `/etc/hosts` pin) · rustdesk-server image is shell-less (logs-only) · clients see ONE server at a time · IPv6-P2P toggle = recorded post-gate experiment (runbook §12).

## Carry-forward hygiene (non-blocking)

Temp guest-audio diagnostics still on `main` (removal list: `docs/handoffs/2026-06-30-first-call-audio-debug-handoff.md` §4) · GitHub secret-scanning alert still open · Supabase-Auth-gripes homework (feeds the Phase-5 DB record) still unanswered · pilot phone line NOT yet transferred (deliberate training sequencing — kiosk first; Phase 3 lands before phone volume, by design).

## Register reminder

Real dialogue, plain English, no pick-one menus (`feedback-brainstorm-dialogue`) — the spec gate + plan review are conversations. Decide-don't-menu when one answer is sane (`feedback-decision-style`). Build for the future, not just the pilot. Sourcing discipline on every number. Nights always run on proven infrastructure.
