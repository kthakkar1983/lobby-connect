# Handoff — Phase 1 kickoff: dialogue done, awaiting domain + DO account (start here)

**Date:** 2026-07-02 · **Branch:** `main` (docs only, no code) · **Supersedes:** `2026-07-01-stack-consolidation-design-complete-handoff.md`

## Where Phase 1 stands

Mid-brainstorm per the house workflow (brainstorm → spec → plan → build). The **clarifying dialogue with Kumar is DONE** — decisions below. **NOT yet done:** design presentation → spec → plan → build. Kumar is securing the domain + DO account and returns in a few hours; next session opens by collecting his inputs, then **presents the Phase-1 design for approval**.

## Kumar's homework (in progress — collect these first)

1. **Domain name** (deciding with his India partner) + purchase on **Cloudflare Registrar** (+ 2FA on the account).
2. **DigitalOcean account** with billing (+ 2FA), and EITHER a **scoped API token** (recommended — Claude drives via `doctl`; scopes: droplet + firewall + ssh_key read/write, ~90-day expiry) OR he clicks the console with exact written steps. He has the shopping list (droplet spec below).
3. *(Optional, feeds the Phase-5 DB decision record)* What specifically he dislikes about **Supabase Auth** — free-tier frictions (mostly engineered around by Plan 9, or die at Pro) vs deeper model gripes. Asked, unanswered.

## Decisions locked this session (sources inline)

1. **Region = ATL1.** Measured TCP-connect RTT from Kumar's OKC Cox connection (2026-07-02, best-of-4 via `{region}.digitaloceanspaces.com` — the old `speedtest-*.digitalocean.com` hosts are NXDOMAIN): **ATL1 30 ms**, SFO2/SFO3 54–55, NYC3 58, TOR1 58. Both Supabase projects live in `us-east-1`, so east coast also wins the box↔DB leg (ATL↔N.Virginia ~12–17 ms, *geography estimate*). **Verify at provision:** Basic Regular 4c/8GB exists in ATL1 (newest US region); **fallback NYC3**.
2. **Registrar + DNS = Cloudflare.** At-cost: **.com $10.46/yr, .app $14.20/yr** ([cfdomainpricing.com](https://cfdomainpricing.com/), fetched 2026-07-02); free WHOIS privacy. One account later also holds the R2 backup bucket. **Infra hosts stay DNS-only/grey-cloud** (relay/TURN are raw TCP/UDP the CF proxy can't carry; Coolify mints its own Let's Encrypt certs). The landing-page apex may proxy orange-cloud later — independent choice.
3. **Domain shape: ONE domain.** Apex + `www` reserved for the **marketing landing page** (~1 month out, partner may host it anywhere); software on subdomains per the spec map — `staging.`/`staging-kiosk.` (Phase 1), `relay.` (P2), `livekit.`/`turn.` (P4), `app.`/`kiosk.` (P5). Availability checked 2026-07-02: `lobbyconnect.com` + `.io` **taken**; available: **`lobby-connect.com`** (recommended — matches repo/product naming), `lobbyconnect.app`, `.net`, `.co`, `.us`, `try-`/`use-` prefixes. The split option (software on `.app`, landing on `.com`) was discussed → **works but adds a second zone/renewal for zero technical benefit**; optional defensive `.app` grab = redirect only. Name = Kumar + partner, pending.
4. **DO auto-backups: skip at creation.** Box holds nothing irreplaceable during Phases 1–4 (apps/config rebuild from git + runbook). Safety = **manual snapshots before each migration phase** (*~$0.06/GiB-mo, prior-knowledge estimate*). **Enable the weekly auto-backup toggle at Phase-5 cutover** (one click, any time — that's when box-death starts meaning missed calls). Never-lose items from day one, backed up as files: RustDesk server keypair (P2), Coolify env dump.
5. **Supabase Pro: defer to Phase 5.** Staging free-tier auto-pause solves itself (the box's `*/15` cron traffic = activity; *verify during the soak week*). **BUT the fact-check surfaced a live gap: the free tier includes ZERO automated backups** ([supabase.com/pricing](https://supabase.com/pricing), checked 2026-07-02) → **prod pilot data is unprotected today**. → **NEW Phase-1 deliverable (pulled forward from Phase 5):** nightly prod `pg_dump` from the box via a **dedicated read-only DB role** (`pg_read_all_data`, not the master password), later shipped to R2. *(Phase-5 note: Supabase bills per-org — Pro org + 2 active projects ≈ $35/mo since each project meters compute; dodge = staging in a separate free org. Verify then.)*
6. **Decision record added to the target spec (§3): why not AWS / Cloudflare hosting** (Kumar's challenge, answered + recorded): CF Workers/Pages/Containers cannot receive non-HTTP TCP/UDP ([CF Containers docs](https://developers.cloudflare.com/containers/)) → LiveKit + RustDesk relay can't run there, and CF Calls is a metered SFU (the Agora shape); AWS egress $0.09/GB after 100 GB free ([AWS](https://aws.amazon.com/ec2/pricing/on-demand/)) → ~$81–126/mo at our 1–1.5 TB estimate vs **5 TB included** at DO, plus ~2.5× compute (*estimate*) and console/IAM burden vs the India-maintainer constraint. Kumar also stress-tested **"is keeping the DB managed the same mistake as Agora?"** → resolved NO: the Agora trap was metered pricing + no exit; Supabase is flat-priced and fully OSS/self-hostable (exit door permanently open; nightly dumps in our own bucket = data control now). **Own the stateless, rent the stateful**; the Phase-5-last DB decision stands — and a later self-host would bring GoTrue along, answering his auth-control concern too.

## Migration-period cost (net new, from the decisions above)

**~$49/mo during Phases 1–4** (droplet $48 + domain ~$0.90) → rises to the spec's **~$84/mo** at Phase-5 go-live (+$9.60 backups, +$25 Supabase Pro).

## Preflight status (all confirmed 2026-07-02)

- **Staging Supabase** (`cgtvqjxhbojztzumshca`): was INACTIVE (free-tier auto-pause) → Kumar restored → **ACTIVE_HEALTHY**.
- **`staging` branch: 66 commits behind `main`** → re-sync (runbook `reset --hard main` flow) during build.
- **Kumar's Mac: no SSH keys, no `doctl`** → runbook covers keygen (+ doctl install if token path chosen).
- Machine location = OKC confirmed (Cox static IP) → the RTT numbers are pilot-relevant.

## Next-session runsheet

1. Collect the three homework inputs.
2. **Present the Phase-1 design** (per the brainstorm flow — approaches where real alternatives exist, then sections): DNS records + TLS; box + hardening (Ubuntu 24.04 LTS, SSH-key-only, DO cloud firewall + ufw, fail2ban, unattended-upgrades); Coolify install + GitHub connect; staging portal (standalone Next build) + kiosk (static) pointed at staging Supabase; **staging basic-auth shape — MUST exempt `/api/kiosk/*`** (already HMAC-token-protected) **or we recreate the exact Vercel wall that broke kiosk-on-staging** (see staging runbook §"Kiosk on staging — DEFERRED"); crons as Coolify scheduled tasks hitting the `CRON_SECRET` endpoints (reaper finally `*/15` on staging) **+ the new nightly prod `pg_dump` task**; ops runbook skeleton in `docs/setup/` (the India-maintainer artifact); smoke criteria (sign-in, dashboards, kiosk end-to-end, crons fire; **done when staging runs a week unattended**).
3. Then: spec → `docs/specs/` → self-review → Kumar review gate → `writing-plans` → build.

## Carry-forward hygiene (unchanged)

Temp guest-audio diagnostics still on `main` (removal list: `docs/handoffs/2026-06-30-first-call-audio-debug-handoff.md` §4) · GitHub secret-scanning alert still open · first-call-audio root cause still not airtight.

## Register reminder

Real dialogue, plain English, no pick-one menus (`feedback-brainstorm-dialogue`). Build for the future, not just the pilot (`feedback-forward-compat`). Sourcing discipline on every number.
