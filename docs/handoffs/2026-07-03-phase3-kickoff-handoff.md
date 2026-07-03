# Handoff — Phase 3 kickoff (Gate 3.0 tile prototype first); Phase-2 real-night stamp + July-10 soak checkpoint pending (START HERE)

**Written:** 2026-07-03 (~10:15 UTC, end of the Phase-2 build/cutover session) · **Supersedes:** `2026-07-03-phase2-server-built-handoff.md` · **Branch:** `main`

## Where things stand (three threads, two of them passive)

1. **Phase 2 (RustDesk relay) — ALL runsheet steps DONE 2026-07-03, one gate pending.** Server + all four clients cut over in a single day: hbbs/hbbr `1.1.15` key-enforced on the box · Kumar's Mac (`139513354`) · **the pilot hotel PC** (`511505435` — Kumar repointed on-site; the pilot property shares his network) · India admin (`250885235`) · **pilot agent Dilnoza (`428868591`, India mobile/CGNAT)**. Evidence: admin worked the hotel PC through **hbbr** (verdict "snappy" on the relayed worst case, incl. ~12 min of real work); **Dilnoza + Kumar connected DIRECT P2P — zero hbbr trace** (relay = fallback-only, exactly as designed); **0 auth failures ever**. Spec/plan/runbook: `docs/specs/2026-07-03-phase2-rustdesk-relay-design.md` · `docs/plans/2026-07-03-phase2-rustdesk-relay.md` · runbook §12. **Pending: the done-when gate — Dilnoza works one full night through our relay (likely the next US night). See "Close Phase 2" below.**
2. **Phase 1 — SOAK RUNNING** to ~2026-07-10, passive. Checklist below.
3. **Phase 3 — NOT started; this handoff is its kickoff brief.**

Prod (Vercel + Twilio + Agora) remains untouched by all of the above. Dilnoza's *workflow* is unchanged (same app, same ID/password — only the server behind it changed); standalone-RustDesk-via-public-relay stays the documented fallback (rollback = clear Network fields on both ends; Kumar is on-site for the hotel PC).

## Close Phase 2 (run the moment Kumar confirms Dilnoza's clean night)

1. Migration plan Phase-2 STATUS block: prepend **DONE (real night <date>)**; tick the plan's done-when checkbox.
2. `git tag plan-phase2-relay-complete && git push --tags`.
3. Sync CLAUDE.md current-focus + `MEMORY.md` + `memory/project-status.md` + auto-memory (one line each: Phase 2 DONE).
4. If the night was NOT clean: runbook §12 incident steps (logs → ports → fallback swap), debug with the soak untouched.

## Phase 3 — agent+admin workspace (kickoff brief)

**Feature work on CURRENT hosting (Vercel/Agora) — zero infra risk by design.** House workflow in full: **brainstorm (real dialogue, no menus) → spec → Kumar gate → plan → build.** Locked scope lives in the migration plan Phase-3 section + target spec §5/§5b; brand rules in `docs/brand/brand-guidelines.md` + `docs/DESIGN.md`.

**Gate 3.0 comes FIRST — before any Phase-3 build:** a 1–2 day spike building ONLY the always-on-top deskphone tile (Document Picture-in-Picture): opens from a "Go on duty" click (which also primes audio) · rings above fullscreen YouTube **and** above a fullscreen RustDesk session · resizable · on the agents' REAL machines (Chrome/Edge). Kumar + Dilnoza judge it live. Also verifies: PiP exempts the parent tab from throttling; the tile floats over OS-fullscreen video. **Pass → build Phase 3. Fail → decide the thin-desktop-shell escalation there, before anything else.**

**Phase 3 proper (locked headlines):** shared property-card dashboard (agent = pod; **admin = pod-grouped fleet view** under the command-center strip; on-card ringing + Answer, admin ring gated by `covering`; retires the separate incoming layouts; NO routing/Twilio changes) · `property_remote_access` migration + admin CRUD + audited just-in-time credential API + **Connect** deep link (`rustdesk://connection/new/<id>?password=<pw>`; admins connect to ANY property) · deskphone tile in full (deskphone ⇄ call-controls morph, mute/hold/hang-up/911, quick Room#/note, cross-property ring) · **Web Push OS notifications** (alerting layer 2 — folds in the 2026-06-30 background-alerting thread) · **hold** (Twilio Conference seam + video track pause) · Chrome/Edge agent SOP (runbook §11 seam). The 911 path gets the usual byte-level review treatment.

**Carry into the P3 spec:** design the credential API with the **enrollment-token self-registration seam** in mind (`docs/v2-backlog.md` → "Self-registering hotel-PC provisioning") so fleet onboarding stays one-script; the provisioning script template is `ops/rustdesk/provision-hotel-pc.ps1` (config string + per-PC password live in Kumar's PM).

## The July-10 checkpoint: VERIFY THE SOAK HELD (on/after ~2026-07-10, whatever else is in flight)

How-tos in the runbook; ~7 soak days expected. Includes the relay now.

1. **Box:** `doctl compute droplet get 581936683 --format Name,Status` = active · SSH `uptime` (no reboot outside the 17:00 UTC patch window) · `df -h /` (<20%).
2. **Coolify scheduled tasks** (app `su8p4jpng7izpzl7e7sw4k8o`): reaper ≈96/day all success · presence 1/day · prod-pg-dump 1/day.
3. **Dumps:** `ls /data/lc-backups/` — one per night, oldest pruned at 14.
4. **Staging Supabase did NOT auto-pause:** MCP `execute_sql` on `cgtvqjxhbojztzumshca` works; `health_signals.cron_reap_stale_calls.last_ok_at` within 15 min.
5. **Front door:** portal + kiosk anon → 401 Basic; `/api/kiosk/config` → app-4xx without a Basic challenge.
6. **Relay:** hbbs/hbbr both Up, same `Key:` lines, no `Authentication failed` flood (runbook §12 health check).
7. **Kumar:** no DO alert emails; agent/owner dashboards eyeballed on staging.

**All green → close Phase 1:** stamp `STATUS: DONE` in the migration plan Phase-1 section · tag `plan-phase1-box-staging-complete` + push tags · sync CLAUDE.md/MEMORY/project-status. Any red → runbook §8 first.

## Build gotchas worth carrying

1. Coolify passes Traefik labels **verbatim** — NO compose-style `$$` doubling.
2. Next's build imports API route modules — module-scope env getters must not throw (portal Dockerfile carries a build-stage service-key dummy).
3. Coolify env vars have inert `is_preview=true` twin rows — ignore.
4. hbbs DNS-resolves its `-r` hostname at startup and **silently drops it on failure** → pinned via compose `extra_hosts` + box `/etc/hosts`; if the box IP changes, update both (runbook §12).
5. The rustdesk-server image is **shell-less** — logs-only debugging.
6. RustDesk clients see peers on only ONE server at a time (drove the H5 both-ends-together swap; matters for any future fleet migration).
7. Recorded post-gate tuning experiment (NOT done): client "Enable IPv6 P2P connection" on both ends of a pair (runbook §12).

## Carry-forward hygiene (non-blocking)

Temp guest-audio diagnostics still on `main` (removal list: `docs/handoffs/2026-06-30-first-call-audio-debug-handoff.md` §4) · GitHub secret-scanning alert still open · Supabase-Auth-gripes homework (feeds the Phase-5 DB record) still unanswered.

## Register reminder

Real dialogue, plain English, no pick-one menus (`feedback-brainstorm-dialogue`) — Phase 3 opens with a brainstorm, so this matters immediately. Build for the future, not just the pilot. Sourcing discipline on every number. Nights always run on proven infrastructure.
