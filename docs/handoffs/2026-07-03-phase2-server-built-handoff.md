# Handoff — Phase 2 server side BUILT; Kumar's client runsheet + the July-10 soak checkpoint (START HERE)

**Written:** 2026-07-03 (~05:45 UTC) · **Supersedes:** `2026-07-03-phase2-relay-kickoff-handoff.md` · **Branch:** `main`

## Where things stand

Two concurrent threads, exactly as planned:

1. **Phase 1 — SOAK RUNNING** to ~2026-07-10. Nothing changed on the staging apps this session; the relay was deployed **outside Coolify** (disjoint failure domain, by design) after snapshot `pre-phase2-relay` (19.41 GiB, 05:25 UTC). The July-10 checklist below is unchanged from the previous handoff.
2. **Phase 2 — server side BUILT + VERIFIED 2026-07-03.** hbbs/hbbr `1.1.15` live at `/opt/rustdesk/` on lc-box-1, key-enforced (`-k _`), ports proven from outside (TCP 21115/21116/21117 connect; UDP 21116 packet-captured on eth0 through DO fw + ufw; 21118/21119 verified blocked). Keypair backed up to the Mac (`~/.ssh/lc_relay_id_ed25519{,.pub}`); public key in runbook §12. Spec: `docs/specs/2026-07-03-phase2-rustdesk-relay-design.md` · plan: `docs/plans/2026-07-03-phase2-rustdesk-relay.md` · ops: runbook §12.

**Prod (Vercel + Twilio + Agora) untouched. The pilot agent's workflow untouched** — she stays on standalone-RustDesk-via-public-relay until H5.

## Kumar's Phase-2 runsheet (each step gates the next — full detail in the plan's H1–H5)

> **Progress (2026-07-03, same day): H1–H4 DONE + H5 HALF-DONE.** DNS verified end-to-end; keypair + export-config string in PM. On our hbbs, key-authenticated: Kumar's Mac (`139513354`) · **the pilot hotel PC** (`511505435` — Kumar repointed it same day, on-site hands) · the India admin (`250885235`). hbbr carried three admin↔hotel-PC sessions (incl. ~12 min of real work) — **the actual production pair**; admin verdict: **definite speed improvement — "snappy" — on the relayed worst case**. Zero auth failures. **REMAINING: the pilot agent's client swap** (three Network fields + Key; then same hotel-PC ID + password as always) **+ the real-night done-when. ⚠ Until she swaps, her public-relay client cannot reach the hotel PC — the admin (on ours) covers.** Rollback is now two-sided by definition: clearing the fields on BOTH the hotel PC (Kumar, on-site) and her client returns everything to the public relay.

1. **H1 — DNS (2 min):** Cloudflare → `lobby-connect.com` → A · name `relay` · `159.203.124.112` · **DNS only (grey cloud)**. Until this lands, no client can be tested.
2. **H2 — PM backup (5 min, don't defer):** PM secure note "LC relay server keypair" ← `~/.ssh/lc_relay_id_ed25519` (+ `.pub`). Top of the never-lose list.
3. **H3 — Your client:** Settings → Network → ID server `relay.lobby-connect.com` · Relay `relay.lobby-connect.com` · Key = `cat ~/.ssh/lc_relay_id_ed25519.pub` (kept out of the public repo — it's the relay's access token under `-k _`; runbook §12). Expect **Ready**. Test a session; check the lock icon (encrypted, direct-vs-relay). Then **Export Server Config** → PM entry "RustDesk exported server config" (paste into a local copy of the provisioning script at provision time; the repo keeps the placeholder).
4. **H4 — India-side agent test** (the leg that matters; coordinate who): her client → our server → a US test PC (NOT the pilot hotel PC). Felt latency vs public relay + direct/relay observation.
5. **H5 — Pilot hotel PC, LAST**, at a scheduled daytime moment with the agent available (no forced date). Rollback forever = swap Network fields back to the public relay.

**Phase-2 done-when:** the pilot agent works a real night through our relay → stamp the migration-plan Phase-2 STATUS + tag `plan-phase2-relay-complete`.

## The July-10 checkpoint: VERIFY THE SOAK HELD (run on/after ~2026-07-10, whatever else is in flight)

Unchanged from the kickoff handoff; how-tos in the runbook. ~7 soak days expected. **One addition (relay now runs on the box): hbbs/hbbr both Up + same-key log lines (runbook §12 health check).**

1. **Box:** `doctl compute droplet get 581936683 --format Name,Status` = active · SSH `uptime` (no unexplained reboot outside the 17:00 UTC patch window) · `df -h /` (<20%).
2. **Coolify scheduled tasks** (app `su8p4jpng7izpzl7e7sw4k8o`): reaper ≈96/day all success; presence 1/day; prod-pg-dump 1/day.
3. **Dumps:** `ls /data/lc-backups/` — one per night, oldest pruned at 14.
4. **Staging Supabase did NOT auto-pause:** MCP `execute_sql` on `cgtvqjxhbojztzumshca` works; `health_signals.cron_reap_stale_calls.last_ok_at` within 15 min.
5. **Front door:** portal + kiosk anon → 401 Basic; `/api/kiosk/config` → app-4xx without a Basic challenge.
6. **Kumar:** no DO alert emails; agent/owner dashboards eyeballed on staging.

**All green → close Phase 1:** stamp `STATUS: DONE` in the migration plan Phase-1 section · tag `plan-phase1-box-staging-complete` + push tags · update CLAUDE.md current-focus + `MEMORY.md` + `memory/project-status.md`. Any red → runbook §8 first.

## After Phase 2's runsheet: Phase 3

Phase 3 (deskphone tile + property cards + Connect + Web Push alerting) is feature work on current hosting, decoupled from infra — **opens with Gate 3.0, the 1–2 day always-on-top tile prototype** (pass → build; fail → desktop-shell decision). Own brainstorm→spec→plan cycle per the migration plan. It can start before H4/H5 complete if Kumar wants parallel progress — only H5 has real-world stakes.

## Build gotchas worth carrying (Phase 1 + Phase 2)

1. Coolify passes Traefik labels **verbatim** — NO compose-style `$$` doubling.
2. Next's build imports API route modules — module-scope env getters must not throw (portal Dockerfile carries a build-stage service-key dummy).
3. Coolify env vars have inert `is_preview=true` twin rows — ignore.
4. First boot of a fresh droplet: cloud-init holds the dpkg lock — `-o DPkg::Lock::Timeout=600`.
5. **NEW: hbbs DNS-resolves its `-r` relay hostname at startup and silently drops it on failure** (`test_if_valid_server` → `to_socket_addrs`) → pinned via compose `extra_hosts` + box `/etc/hosts`. If the box IP changes, update both pins (runbook §12).
6. **NEW: the rustdesk-server image is shell-less** — no `docker exec` debugging; use logs (`docker logs hbbs`) and behavior lines (`relay-servers=[…]`, `Key:`).

## Carry-forward hygiene (non-blocking)

Temp guest-audio diagnostics still on `main` (removal list: `docs/handoffs/2026-06-30-first-call-audio-debug-handoff.md` §4) · GitHub secret-scanning alert still open · Supabase-Auth-gripes homework (feeds the Phase-5 DB record) still unanswered. ~~macOS `"* 2.*"` duplicate files~~ — resolved: working tree was clean at session start 2026-07-03.

## Register reminder

Real dialogue, plain English, no pick-one menus. Build for the future, not just the pilot. Sourcing discipline on every number. Nights always run on proven infrastructure — prod is untouched by everything above.
