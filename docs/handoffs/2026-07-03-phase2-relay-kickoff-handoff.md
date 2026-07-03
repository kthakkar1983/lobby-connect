# Handoff — Phase 2 kickoff: RustDesk relay (soak runs in parallel) (START HERE)

**Written:** 2026-07-03 (~04:45 UTC, the same session that built Phase 1) · **Supersedes:** `2026-07-02-phase1-kickoff-handoff.md` · **Branch:** `main`

## Where things stand

**Phase 1 is BUILT + SMOKE-PASSED (2026-07-02→03, one session) but NOT yet DONE** — the done-when gate is **staging running a week unattended, checkpoint ~2026-07-10**. The soak began 2026-07-03 ~04:00 UTC. **Sequencing decision (Kumar + Claude, 2026-07-03): Phase 2 STARTS NOW, concurrent with the soak** — the plan itself marks Phase 2 "independent of everything else — do it early"; the soak is passive observation and July 10 is a *checkpoint inside whatever we're doing that day*, not a start gate. Named trade-off: two variables on one box if something misbehaves mid-week — mitigated by the pre-phase2 snapshot (mandatory FIRST step below) and near-disjoint failure domains. Full build record: migration plan Phase-1 STATUS block + `memory/project-status.md` 2026-07-03 entry. Ops reference: `docs/setup/2026-07-02-box-ops-runbook.md` · credentials: `docs/setup/2026-07-03-accounts-credentials-inventory.md`.

Standing access decision (Kumar, 2026-07-03): **both `lc-claude` API tokens (DO + Coolify) stay active through the migration** for debugging; revoke at Phase-5 close. `doctl` is authed on the Mac; the Coolify token is in the transcript/register.

## The July-10 checkpoint: VERIFY THE SOAK HELD (run this on/after ~2026-07-10, whatever else is in flight)

All checks have exact how-tos in the runbook; expected values assume ~7 soak days:

1. **Box:** `doctl compute droplet get 581936683 --format Name,Status` = active · SSH: `uptime` (no unexplained reboot except 17:00 UTC patch window), `df -h /` (<20%).
2. **Coolify scheduled tasks** (app `su8p4jpng7izpzl7e7sw4k8o`, via API or UI): reaper ≈ 96 executions/day all success (gaps = incident); presence 1/day; **prod-pg-dump 1/day — first scheduled run was 2026-07-03 13:00 UTC**.
3. **Dumps:** `ls /data/lc-backups/` on the box — one per night since 07-03, oldest pruned at 14.
4. **Staging Supabase did NOT auto-pause** (the `*/15` traffic test): MCP `execute_sql` on `cgtvqjxhbojztzumshca` succeeds; `health_signals.cron_reap_stale_calls.last_ok_at` within 15 min.
5. **Front door:** portal + kiosk anon → 401 Basic; `/api/kiosk/config` → app-4xx without a Basic challenge.
6. **Kumar:** no DO alert emails all week; agent/owner dashboards eyeballed on staging (admin already verified).

**All green → close Phase 1:** stamp `STATUS: DONE` in the migration plan Phase-1 section · `git tag plan-phase1-box-staging-complete && git push --tags` · update CLAUDE.md current-focus + `MEMORY.md` + `memory/project-status.md`. **Any check red → debug first** (runbook §8); the soak gate exists precisely to catch this.

## Phase 2 — self-hosted RustDesk relay (first prod-facing win; start immediately)

House workflow applies: brainstorm (dialogue register) → spec → Kumar gate → plan → build. Locked scope from the migration plan + target spec §4. **Internal sequencing rule (the real safety mechanism): snapshot → deploy hbbs/hbbr → test with Kumar's own client first → India-side agent test → repoint the PILOT hotel PC LAST** — the pilot PC is the only step with real-world stakes (the agent's actual front-desk path), and its safety comes from Phase 2's instant rollback (one config swap back to the public relay) + the standalone-RustDesk fallback, not from the soak.

- **Step 0: snapshot** — `doctl compute droplet-action snapshot 581936683 --snapshot-name pre-phase2-relay --wait` (phase-boundary rule).
- Deploy **hbbs (ID/rendezvous) + hbbr (relay)** — official `rustdesk/rustdesk-server` OSS images — on the box. Note: raw TCP/UDP services → **Traefik is NOT in the path**; host-published ports (Coolify service with published ports, or compose network_mode host — decide at build).
- **DNS:** `relay.lobby-connect.com` A → `159.203.124.112`, **grey-cloud** (CF proxy can't carry this traffic — locked).
- **Firewall (DO + ufw): open 21115/tcp, 21116/tcp+udp, 21117/tcp. 21118/21119 (web client) STAY CLOSED** (we don't use the web client — locked). Runbook §11 already stubs this.
- **Key discipline:** hbbs generates the server keypair on first start → **pin the public key in all client configs; back the keypair up to Kumar's PM immediately** (top of the never-lose list, spec §3). An unencrypted-session indicator on any client = incident (spec §4 PCI rule).
- Reconfigure the **pilot hotel PC + the agent's client** to our server via the `--config <encrypted-string>` mechanism (docs cited in target spec §4); verify **direct P2P happens when possible** and relay fallback works; feel latency vs the public relay.
- **The relay-vs-P2P smoke MUST include a real India-side agent** — consequence of the Phase-1 region decision record (~95% of agents are India-based; their path India↔US is the one that matters). Kumar coordinates who.
- Document the per-hotel-PC provisioning script (silent install + config + unattended password) — becomes the Phase-3 onboarding tool.
- **Rollback:** repoint clients to the public relay (one config swap). **Done when:** the pilot agent works a real night through our relay.

## Build gotchas worth carrying (learned in Phase 1)

1. **Coolify passes Traefik labels verbatim** — NO compose-style `$$` doubling (cost us a broken basic-auth hash).
2. **Next's build imports API route modules** ("Collecting page data") — module-scope env getters must not throw; the portal Dockerfile carries a build-stage `SUPABASE_SERVICE_ROLE_KEY` dummy for exactly this.
3. Coolify env vars have inert `is_preview=true` twin rows — ignore them.
4. Coolify's API is broad but not complete; its OpenAPI spec (repo `coollabsio/coolify`, `openapi.json`) resolves field questions fast (storages `type` enum = `persistent`/`file`).
5. First boot of a fresh droplet: cloud-init holds the dpkg lock — use `-o DPkg::Lock::Timeout=600`.

## Carry-forward hygiene (unchanged, non-blocking)

Temp guest-audio diagnostics still on `main` (removal list: `docs/handoffs/2026-06-30-first-call-audio-debug-handoff.md` §4) · GitHub secret-scanning alert still open · Supabase-Auth-gripes homework (feeds the Phase-5 DB record) still unanswered · a pile of untracked macOS `"* 2.*"` duplicate files polluting `git status` (surfaced 2026-07-03 — confirm junk + delete).

## Register reminder

Real dialogue, plain English, no pick-one menus (`feedback-brainstorm-dialogue`). Build for the future, not just the pilot (`feedback-forward-compat`). Sourcing discipline on every number. Nights always run on proven infrastructure — prod (Vercel + Twilio + Agora) is untouched by everything above.
