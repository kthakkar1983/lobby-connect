# Phase 1 — the box, the domain, staging hosting (design spec)

**Date:** 2026-07-02 · **Status:** LOCKED pending Kumar's review gate · **Parents:** target architecture `docs/specs/2026-07-01-stack-consolidation-target-architecture-design.md` · migration plan `docs/plans/2026-07-01-stack-consolidation-migration.md` (Phase 1) · kickoff handoff `docs/handoffs/2026-07-02-phase1-kickoff-handoff.md`

Sourcing per CLAUDE.md discipline: facts below are **source-backed** (linked, or verified live via `doctl`/repo on 2026-07-02) unless labeled *estimate*, *prior knowledge*, or *verify at build*.

---

## 0. Inputs collected (2026-07-02)

- **Domain: `lobby-connect.com`, purchased on Cloudflare Registrar** (Kumar, 2026-07-02). Zone lives on Cloudflare; no nameserver move needed.
- **DO account active** (droplet limit 3 — fine for one box plus snapshot-restore tests; verified via `doctl account get`). **Full-access API token** issued by Kumar, stored only in `~/.config/doctl/config.yaml` on his Mac (never committed). Hygiene: revoke or rotate it in the DO console once Phase-1 provisioning is done; treat as a password until then.
- **Preflight verified live via `doctl` (2026-07-02):** region **NYC3 available**; size **`s-4vcpu-8gb` = 4 vCPU / 8 GB / 160 GB SSD / $48/mo / 5 TB transfer, available in NYC3, NOT offered in ATL1** (confirms Kumar's console observation); image **`ubuntu-24-04-x64`** available.

## 1. Region decision — NYC3 (supersedes ATL1; decision record)

ATL1 is moot (the size isn't offered there), but the decisive input is a **newly surfaced business fact: ~95% of agents/admins will be India-based; 100% of hotels are US** (US night shift = India daytime — part of why the labor model works). An India-region server was considered and **rejected**:

1. **The DB anchors us US-East.** Both Supabase projects are in AWS `us-east-1` and stay managed (locked). Every dashboard page and — critically — **every Twilio webhook in the call-setup chain** does multiple DB round trips: ~7–12 ms each from NYC (*geography estimate*) vs ~200 ms+ from India, which would slow **US guests' ring path** several-fold. Guests outrank dashboards.
2. **The agent↔hotel long haul is fixed by geography, not server placement.** India↔US ≈ 200–250 ms (*prior knowledge*). A middle hop (RustDesk relay, LiveKit SFU) only chooses which side gets the short leg; the total stays the same. RustDesk's design norm is direct P2P anyway (relay = fallback).
3. **US-East beats US-West for India traffic** (routes via Europe): Mumbai↔NYC ≈ 180–220 ms vs Mumbai↔US-West ≈ 230–250 ms (*prior-knowledge estimates*). NYC3 is simultaneously best for the DB, Twilio, the 100%-US hotels, Kumar in OKC (58 ms, measured 2026-07-02), and the best US option for the India team.

**What India agents feel:** ~one long RTT per dashboard navigation (tolerable); call audio rides Twilio's global edges, not our box (*verify the right Twilio Voice SDK `edge` setting when India agents onboard*). **Recorded seams, not built:** Cloudflare-proxying the app hostname; a small India relay/TURN node later (split-ready containers make it an afternoon). **Consequence for later phases:** Phase-2 (relay-vs-P2P) and Phase-4 (LiveKit-vs-Agora quality) smokes MUST include a real India-side agent.

## 2. Scope

**Delivers:** hardened NYC3 box · Cloudflare DNS for the infra hosts · Coolify · staging portal + kiosk served from the box against staging Supabase (`cgtvqjxhbojztzumshca`) · crons at the long-deferred `*/15` cadence · **nightly prod `pg_dump`** (prod pilot data is otherwise backup-less on the free tier) · ops runbook.

**Non-goals:** anything prod-facing (prod stays on Vercel until Phase 5) · RustDesk relay (P2) · LiveKit/TURN (P4) · landing page (apex parked) · staging video calls (Agora is shadowed off on staging; video-on-staging becomes real at P4 via LiveKit on this same box — Phase-1 kiosk smoke = loads/config/Home/ringing-screen, not a connected video call) · Supabase Pro / DO auto-backups / R2 offsite (all P5 per the locked deferrals).

## 3. DNS + TLS

Zone: Cloudflare. All infra records **DNS-only (grey-cloud)** per the locked rule; Coolify mints Let's Encrypt certs per host. Kumar clicks the three records at build time with exact values (a zone-scoped CF API token is an optional alternative if he'd rather hand that off too).

| Record | Type | Target | When |
|---|---|---|---|
| `coolify.lobby-connect.com` | A | droplet IP | Phase 1 (Coolify UI) |
| `staging.lobby-connect.com` | A | droplet IP | Phase 1 (portal) |
| `staging-kiosk.lobby-connect.com` | A | droplet IP | Phase 1 (kiosk) |
| apex + `www` | — | parked | landing page, ~1 month out |
| `relay.` / `livekit.` / `turn.` / `app.` / `kiosk.` | — | — | P2 / P4 / P5 per the spec map |

## 4. The droplet + hardening

**Provision (via `doctl`, commands recorded in the runbook):** `s-4vcpu-8gb` · `nyc3` · `ubuntu-24-04-x64` · **IPv6 enabled** (direct path to Supabase Postgres for `pg_dump`; Supabase direct connections are IPv6-first — *verify at build; session-pooler IPv4 is the fallback*) · **DO monitoring agent on** (free graphs + email alert policies: disk >80%, CPU/memory sustained — *thresholds set at build*) · hostname `lc-box-1` · new ed25519 SSH keypair generated on Kumar's Mac and registered at creation.

**Hardening (each step = a runbook entry):**
- SSH: key-only (`PasswordAuthentication no`), root login with key (DO default; Coolify requires root); fail2ban `sshd` jail.
- **DO cloud firewall:** inbound 22/tcp **restricted to Kumar's static Cox IP**; 80/tcp + 443/tcp open; ICMP allowed; all else denied. Later phases append relay/TURN ports. `ufw` mirrors the same rules on-host (defense in depth).
- `unattended-upgrades` with auto-reboot window **17:00 UTC** — US hotel nights span ≈ 03:00–15:00 UTC (23:00 Eastern → 07:00 Pacific), so patch reboots never touch night hours; ≈22:30 IST, after India-agent daytime too. Matters little for staging, but the pattern is set once and inherited by Phase 5.
- 2 GiB swapfile · timezone UTC.

## 5. Coolify + the two staging apps

**Coolify:** latest stable via the official install script ([install docs](https://coolify.io/docs/get-started/installation)); UI at `coolify.lobby-connect.com`; admin account with **2FA**; GitHub App connected to the repo. Both apps auto-deploy from the **`staging` branch** — which is 66 commits behind `main` and gets re-synced first (`reset --hard main` flow per the staging runbook).

**Portal — Dockerfile build (not Nixpacks; decision from the design round: deterministic, monorepo-aware, maintainer-debuggable, carries prod at P5).** Multi-stage: `node:22-alpine` (repo pins Node ≥22 / pnpm 9.15.9 via `packageManager` — verified in `package.json`), corepack-pinned pnpm, workspace install, `pnpm --filter @lc/portal build` with **`BUILD_STANDALONE=1`**, runtime stage copies `.next/standalone` + static assets. Requires the one config change: **env-gated `output: "standalone"` in `next.config.ts`** — gated so the Vercel prod build is byte-identical until Phase 5. *Verify at build:* Next `after()` + image optimization on self-hosted Node (expected fine; smoke covers it).

**Kiosk — Dockerfile build:** Vite build stage (build arg `VITE_PORTAL_API_URL=https://staging.lobby-connect.com`) → `nginx:alpine` static stage with SPA `try_files` fallback (mirrors the `vercel.json` rewrite).

**Env matrices** (names below; values pulled from Vercel's Preview/`staging` scope via the authed CLI at build, then entered in Coolify):

- Portal: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `KIOSK_CONFIG_SECRET`, `EMERGENCY_DIAL_NUMBER=933`, **`NEXT_PUBLIC_APP_URL=https://staging.lobby-connect.com`**, **`KIOSK_ORIGIN=https://staging-kiosk.lobby-connect.com`**, `BUILD_STANDALONE=1`, + the empty shadows (`NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `TWILIO_ACCOUNT_SID`, `AGORA_APP_ID`) — staging stays inert on voice/video/Sentry until P4.
- Kiosk: `VITE_PORTAL_API_URL=https://staging.lobby-connect.com` (build-time).

**Vercel tidy:** `"git": { "deploymentEnabled": { "staging": false } }` in both `vercel.json`s — staging pushes stop triggering Vercel preview builds (they'd queue against prod builds on Hobby and serve nothing anymore).

## 6. Front door — basic auth with carve-outs

Traefik `basicauth` middleware (Coolify custom labels; bcrypt htpasswd hash in the label — hash, never plaintext) on **both** staging hosts. **Carve-outs bypass basic auth** — every path that already carries its own secret:

| Path | Own protection | Why exempt |
|---|---|---|
| `/api/kiosk/*` | HMAC kiosk token (`?t=` / `x-kiosk-token`) | The exact 401 that broke kiosk-on-staging behind Vercel's wall (staging runbook §"Kiosk on staging — DEFERRED") |
| `/api/agora/*` | Dual-branch auth: kiosk HMAC token OR agent/admin session (verified in `app/api/agora/token/route.ts`) | Kiosk calls it **cross-origin** for call tokens (verified: `next.config.ts` applies `KIOSK_CORS` to both path groups); the P4 LiveKit token route inherits this exemption |
| `/api/cron/*` | `CRON_SECRET` bearer | The box's own scheduled tasks call these through the front door |

Anonymous visitors get 401 everywhere else, including the kiosk static site (one browser prompt for humans; the kiosk's API calls go to the carve-outs, so the token flow is unaffected). Exact Traefik label mechanics (router priorities) are plan-level detail; the requirement is fixed: **carve-out paths MUST bypass, everything else MUST challenge.** CORS itself is already handled in-app via the `KIOSK_ORIGIN` env.

## 7. Crons + the prod backup (the "ops" container)

One small Coolify service (`ops`: `postgres:17-alpine` base + `curl`, Dockerfile in-repo) hosts **all scheduled tasks as Coolify scheduled tasks** — run history and logs visible in the one console the future maintainer will actually look at (*Coolify task cadence/logging = verify during the soak week; fallback = host cron, noted in the runbook*).

| Job | Schedule (UTC) | Target |
|---|---|---|
| Reaper — staging | `*/15 * * * *` (the long-deferred cadence, live at last) | `https://staging.lobby-connect.com/api/cron/reap-stale-calls` + `Authorization: Bearer $CRON_SECRET` |
| Presence sweep — staging | daily 08:00 | `…/api/cron/mark-stale-offline`, same auth |
| **Prod `pg_dump`** | nightly **13:00** (post-night for Central/Eastern hotels; harmless read-only tail for Pacific — `pg_dump` takes only ACCESS SHARE locks) | prod Supabase (`ztunzdpmazwwwkxcpyfp`) |

**Backup design:**
- **Role:** `lc_backup` on prod — `LOGIN` + `pg_read_all_data` + **`BYPASSRLS`** (*prior knowledge, verify at build: without BYPASSRLS, `pg_dump` errors on RLS-enabled tables as a non-owner; Supabase's `postgres` role should be able to grant it under PG16 CREATEROLE semantics. Fallback if ungrantable: dump as `postgres` with the password vaulted in Coolify env only — recorded as an accepted exception*). Never the master password in scripts. Created via the dashboard SQL editor — **not** a migration file (instance-level role management, not schema; keeps `supabase/migrations/` schema-only).
- **Client/connection:** `pg_dump` 17 (dumps older servers fine — *prior knowledge*; prod PG major *verified at build via MCP*), direct IPv6 first, session-pooler IPv4 fallback.
- **Format/retention:** `-Fc` compressed, to a Coolify volume, **14-day retention** (pilot DB is MBs — *estimate*). **R2 offsite ship stays at Phase 5** per the locked deferral (a ~30-minute bolt-on whenever, since the Cloudflare account now exists).
- **Restore drill (required, part of smoke):** restore one real dump into a scratch Postgres container on the box; spot-check row counts against live (via MCP). An unrestored backup is a hope, not a backup. The drill procedure = a runbook section.

## 8. Repo changes (all additive; zero app code, zero migrations)

`apps/portal/Dockerfile` + `apps/kiosk/Dockerfile` (+ `.dockerignore`) · env-gated `output: "standalone"` in `apps/portal/next.config.ts` · `git.deploymentEnabled` in both `vercel.json`s · `ops/` (ops-container Dockerfile, `backup.sh`, `restore-drill.sh`) · the runbook (§9). CI is untouched (Dockerfiles aren't in the CI path; *builds verified on the box itself*).

## 9. Ops runbook (the India-maintainer artifact)

`docs/setup/` box-ops runbook (dated at creation), written **as we build, not after**: provision + firewall (every `doctl` command) · SSH access + key locations · Coolify orientation (deploy, env change, logs, rollback, scheduled-task history) · the cron/backup matrix · restore drill · incident checklist ("staging down" → Supabase un-pause / container restart / disk full) · snapshot + vertical-resize how-tos · the Phase-3 agent-machine SOP seam (noted, empty).

## 10. Smoke, done, rollback

**Smoke:**
1. Anonymous visitor → 401 on portal + kiosk hosts; carve-out paths respond without basic auth (all three groups probed).
2. Sign-in at `staging.lobby-connect.com` → agent/admin/owner dashboards render.
3. Kiosk loads end-to-end through the carve-out — config fetch, Home, ringing screen reachable (closes the gap deferred since 2026-06-21; video connect stays inert until P4).
4. Reaper heartbeats visible on staging `/admin/status` at 15-minute spacing; presence sweep fires daily.
5. Nightly prod dump lands; **restore drill passes once**.
6. DO monitoring alert policies active (test email received).

**Done when: staging runs a week unattended** — which also proves the `*/15` cron traffic keeps staging Supabase from free-tier auto-pausing (the handoff's verify-note).

**Rollback:** destroy the droplet; nothing depends on it. The repo changes ride one PR — revert restores Vercel staging exactly as today.

## 11. Cost

$48.00/mo droplet (verified via `doctl`) + $10.46/yr domain (already paid, [cfdomainpricing.com](https://cfdomainpricing.com/), 2026-07-02) ≈ **~$49/mo net-new** — matches the locked migration-period number. Nothing else metered turns on in Phase 1.

## 12. Sources

Live `doctl` verification 2026-07-02 (account / region / size / image) · repo verification 2026-07-02 (`next.config.ts` CORS groups, `vercel.json` crons, `package.json` engines) · [Coolify install](https://coolify.io/docs/get-started/installation) · staging env matrix + kiosk-401 history: `docs/setup/2026-06-21-staging-runbook.md` · parent docs in the header. Latency figures for India/US legs are labeled *prior-knowledge estimates* (no India vantage point to measure from); the region decision is structural (DB/Twilio/hotel anchors) and does not depend on their precision.
