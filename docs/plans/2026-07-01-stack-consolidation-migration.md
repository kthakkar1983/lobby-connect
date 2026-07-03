# Stack consolidation — phased migration plan

**Date:** 2026-07-01 · **Spec:** `docs/specs/2026-07-01-stack-consolidation-target-architecture-design.md` · **Status:** order LOCKED; each phase gets its own detailed spec/plan/smoke at build time (house workflow).

## Principles

1. **Nights always run on proven infrastructure.** The pilot keeps running on the current stack until each replacement piece has passed staging + a prod smoke. Cutovers happen daytime.
2. **One piece at a time, rollback per phase.** Snapshot the box before every phase; every phase lists its revert path. The Vercel deployment stays warm until Phase 5 completes its soak.
3. **Freedom acknowledged, not abused:** pilot is at Kumar's own property with him on-site, and manual fallbacks exist (standalone RustDesk, Google Meet). That buys calm migrations — it doesn't buy skipping smokes.
4. Versioning per `docs/VERSIONING.md`: PR-per-phase, CI green before tags.

## Phase 0 — Hygiene + safety net (repo only, no infra)

- Tag the current prod state as the stable fallback baseline (`pre-consolidation-baseline`) — Kumar's "file it as a stable version."
- **Merge `fix/max-call-duration-cap`** (built @ `abcdcd9`, unmerged): caps runaway/leaked-channel billing while Agora remains live through Phases 1–4.
- Track (not necessarily do now): temp guest-audio diagnostics removal (blocked on pinning the first-call-audio root cause — removal list in `docs/handoffs/2026-06-30-first-call-audio-debug-handoff.md` §4); close the GitHub secret-scanning alert.
- Confirm staging is healthy (Supabase `cgtvqjxhbojztzumshca` + `staging` branch deploys).

**Rollback:** n/a. **Done when:** cap merged + baseline tagged.

**STATUS: DONE 2026-07-01** — tag `pre-consolidation-baseline` @ `47b6a49`; merge `d9f04da` (30-min connected-video-call cap on both clients, guarded under the Agora token TTL; full suite + typecheck + lint green). The two tracked-not-done items (temp diagnostics removal, secret-scanning alert) carry forward as noted above; staging health gets re-confirmed as part of Phase 1 preflight.

## Phase 1 — The box, the domain, staging hosting

- Buy the domain. Provision the DO 4c/8GB droplet (region chosen by measured RTT to OKC); harden (SSH keys only, firewall, fail2ban, unattended upgrades) — write `docs/setup/` ops runbook as we go (the India-maintainer artifact).
- Install Coolify; connect GitHub; deploy **staging** portal + kiosk on the box (pointed at staging Supabase) under `staging.<domain>` with TLS + basic auth; wire Coolify scheduled tasks to the cron endpoints (`CRON_SECRET`), including the long-deferred `*/15` reaper cadence on staging.
- Prove: sign-in, dashboards, kiosk loads end-to-end, crons fire. **Bonus over today:** this un-blocks the kiosk-on-staging gap (no Vercel preview-auth wall).

**Rollback:** destroy droplet; nothing depends on it. **Done when:** staging runs fully on the owned box for a week without babysitting.

**Kickoff 2026-07-02 (brainstorm dialogue done; decisions locked):** region **NYC3** (resolved 2026-07-02: ATL1 doesn't offer the 4c/8GB size — `doctl`-verified — and the newly-surfaced **~95%-India agent workforce** anchors US-East regardless; decision record in the Phase-1 spec §1) · registrar/DNS = **Cloudflare at-cost** (infra hosts grey-cloud/DNS-only) · **one domain**, apex reserved for the ~1-month-out landing page (name = Kumar + partner, pending) · DO auto-backups deferred to Phase 5 (phase-boundary snapshots instead) · Supabase Pro deferred to Phase 5 · **new Phase-1 deliverable: nightly prod `pg_dump` from the box via a read-only DB role** (free tier has zero backups — prod pilot data otherwise unprotected) · migration-period net-new ≈ $49/mo. Preflight: staging Supabase restored ACTIVE_HEALTHY; `staging` branch 66 behind `main` (re-sync at build); no SSH keys/`doctl` on the Mac yet. Full detail + next-session runsheet: `docs/handoffs/2026-07-02-phase1-kickoff-handoff.md`. **Phase-1 spec: `docs/specs/2026-07-02-phase1-box-domain-staging-design.md` · plan: `docs/plans/2026-07-02-phase1-box-domain-staging.md`.**

**STATUS: BUILT + SMOKE PASSED 2026-07-03 (one session) — SOAK RUNNING, done-when gate = one unattended week (checkpoint ~2026-07-10). Phase 2 runs CONCURRENTLY with the soak (decision 2026-07-03; this plan's own "independent — do it early"; July-10 = verify + stamp, not a start gate).** Box `lc-box-1` NYC3 `159.203.124.112` hardened (key-only SSH restricted to Kumar's static IP, ufw+fail2ban, unattended-upgrades w/ 17:00 UTC reboot window, 2G swap, DO email alerts) · Coolify 4.1.2, project `lobby-connect`/env `staging`: `lc-portal-staging` + `lc-kiosk-staging` + `lc-ops`, GitHub App `lc-coolify` auto-deploys branch `staging` · Traefik basic-auth with carve-outs (`/api/kiosk/*` + `/api/agora/*` + `/api/cron/*`) verified — **the kiosk-on-staging 401 gap (staging runbook §"DEFERRED") is CLOSED**, kiosk e2e walked by Kumar (Home → Ringing → apology → auto-Home; video inert until P4 by design) · **reaper finally `*/15`** — backstop demonstrated live (the kiosk walk's leaked RINGING row auto-reaped to NO_ANSWER at the 10-min cutoff) · **nightly prod `pg_dump`** (role `lc_backup` LOGIN+pg_read_all_data+BYPASSRLS, IPv6 direct, `-Fc`, 14-day retention on `/data/lc-backups`) + **restore drill PASS** (calls=225 / auth.users=5, exact match) · repo tranche = PR #25 (Dockerfiles, env-gated standalone, Vercel staging-builds off) · ops runbook `docs/setup/2026-07-02-box-ops-runbook.md` + credentials register `docs/setup/2026-07-03-accounts-credentials-inventory.md`. Build notes: `$$`-doubling in Traefik labels was WRONG for Coolify (labels pass verbatim, no compose interpolation — fixed to single-`$`); staging admin password was lost → reset via GoTrue admin + forced-change flow. **Post-soak checklist: stamp DONE here · tag `plan-phase1-box-staging-complete` · eyeball agent/owner dashboards on staging · then Phase 2.** *(API-token revocation re-pointed to migration end — Phase-5 close — per Kumar 2026-07-03; both `lc-claude` tokens stay for debugging through the migration.)* **Next-session START HERE: `docs/handoffs/2026-07-03-phase2-relay-kickoff-handoff.md`.**

## Phase 2 — Self-hosted RustDesk relay (first prod win)

**STATUS: server side BUILT + VERIFIED 2026-07-03 (~05:30 UTC, concurrent with the Phase-1 soak; snapshot `pre-phase2-relay` taken first) — client cutover = Kumar's runsheet, pilot PC LAST.** hbbs+hbbr `1.1.15` live on lc-box-1 as plain compose at `/opt/rustdesk/` (deliberately NOT Coolify — host networking for real client IPs/P2P + disjoint failure domain from the soaking stack; repo source `ops/rustdesk/compose.yaml`), **key-enforced `-k _`** (key-less clients rejected server-side; hbbs+hbbr share one keypair, log-verified). Ports 21115/tcp+21116/tcp/udp+21117/tcp opened on DO fw + ufw and **proven from outside** (TCP connects; UDP packet captured on eth0 through both firewalls); 21118/21119 verified blocked. Keypair backed up to Mac `~/.ssh/lc_relay_id_ed25519{,.pub}`; public key `oH2Lzh…3GY=` (runbook §12). Build gotcha recorded: hbbs DNS-resolves `-r` at startup and silently drops it on failure → `extra_hosts`/`/etc/hosts` pin. Spec: `docs/specs/2026-07-03-phase2-rustdesk-relay-design.md` · plan+runsheet: `docs/plans/2026-07-03-phase2-rustdesk-relay.md` · ops: runbook §12. **Remaining (human, in order): H1 DNS `relay.` A-record (grey-cloud) → H2 PM keypair backup → H3 Kumar client test (+ export config string into the provisioning script) → H4 India-side agent test → H5 pilot-PC repoint at a scheduled daytime moment. Done-when unchanged: the pilot agent works a real night through our relay.**

- Deploy hbbs/hbbr containers; `relay.<domain>`; pin our server key; keep web-client ports 21118/21119 closed.
- Reconfigure the pilot hotel PC + the agent's client to our server (`--config` string); verify direct P2P happens when possible and relay fallback works; feel the latency vs the public relay.
- Document the per-hotel-PC provisioning script (silent install + config + unattended password) — becomes the Phase-3 onboarding tool.

**Rollback:** repoint clients to the public relay (one config swap). **Done when:** the pilot agent works a real night through our relay. *(Independent of everything else — do it early; immediate speed/security/dogfooding win.)*

## Phase 3 — Agent + admin workspace: deskphone tile + property cards + Connect + hold + layered alerting

Feature work on the current hosting (Vercel) and current video (Agora) — decoupled from infrastructure risk on purpose.

- **Gate 3.0 — deskphone-tile prototype spike (1–2 days, FIRST).** Build only the always-on-top tile: opens on a "Go on duty" click (audio primed), rings over fullscreen YouTube and over a full-screen RustDesk session, resizable, on the agents' real machines. Kumar + the pilot agent judge it live. Also verifies: PiP keeps the parent tab un-throttled; tile floats above OS-fullscreen video. **Pass → build Phase 3. Fail → decide the desktop-shell escalation here, before anything else is built.**
- Property-card dashboard, shared component (agent = pod; **admin = pod-grouped fleet view** under the existing command-center strip). On-card ringing + Answer (gated by `covering` for admins); retires the separate incoming layouts. No routing/Twilio changes.
- `property_remote_access` migration + admin CRUD + audited just-in-time credential API + **Connect** deep link (`rustdesk://connection/new/<id>?password=<pw>`). **Admins can Connect to any property regardless of covering** (locked).
- Deskphone tile in full (deskphone ⇄ call-controls morph: guest video, mute/hold/hang-up/911, quick Room#/note, cross-property ring). Chrome/Edge SOP.
- **Web Push OS notifications (layer 2)** — service worker + push subscription per agent machine; rings even with the tile closed or browser minimized; click focuses the portal. (Folds in the 2026-06-30 background-call-alerting direction.)
- **Hold** (audio via the Twilio Conference seam, video track pause; held state on card + tile). Pre-warm = handshake on answer, render on expand.
- Own brainstorm→spec→plan cycle; the 911 path gets the usual byte-level review treatment.

**Rollback:** normal git revert; no infra involved. **Done when:** prod smoke — answer on card (agent + covering admin), connect to the real hotel PC in one click, admin-connect to a non-covered property, hold/resume, ring lands over fullscreen YouTube via the tile AND as an OS notification with the browser minimized.

## Phase 4 — Video swap: Agora → LiveKit

- Deploy LiveKit + TURN on the box (staging first); resolve the 443 question (TURN on 5349 or second IP).
- Portal token route + kiosk/portal client swap behind the existing call-state machinery; captions re-tap the LiveKit remote track; PiP window unchanged.
- Staging smoke with real devices → prod cutover behind an env flag; **keep the Agora path + env until the LiveKit path survives ≥1 week of real nights**, then strip Agora SDKs/env/token route.

**Rollback:** flip the flag back to Agora (path retained until cleanup). **Done when:** a week of real video calls on LiveKit with quality ≥ Agora and $0 marginal video cost.

## Phase 5 — Prod app cutover off Vercel + decommission

- Deploy prod portal + kiosk on Coolify (prod Supabase env); `app.<domain>` / `kiosk.<domain>`; move crons to the box (reaper to `*/15` in prod at last).
- Cutover checklist: Twilio webhook URLs → new domain; Supabase Auth site/redirect URLs; regenerate kiosk `?t=` links; cross-app env URLs; Sentry origins. Keep Vercel warm during a multi-night soak; rollback = repoint Twilio + DNS back.
- After soak: decommission Vercel projects + Agora account; remove `@vercel/analytics`; update `docs/security-posture.md`, `deploy-and-smoke-workflow` memory, CLAUDE.md deployed-URLs.
- **Then the final DB call** (kept-managed is the standing lean; revisit with real ops experience — this is the last decision on purpose).

**Done when:** a full week of nights served entirely off the owned box + Twilio + Supabase, Vercel and Agora accounts closed.

## Phase 6 — Post-migration (optional, unscheduled)

Realtime phases 2–4 re-evaluated as pure UX (cost pressure gone) · per-connect credential rotation · GlitchTip/Umami self-host · second-box split if load ever asks for it. (Web Push moved INTO Phase 3 — no longer deferred.)

## Sequencing rationale (recorded)

- **Relay before everything prod-facing** (Phase 2): zero code, high win, builds server confidence on a non-life-safety path.
- **Workspace before video swap** (Phase 3 < 4): the agents get the workflow transformation early; the feature is orthogonal to hosting; and the tile/card UI then *wraps* the video internals, so the LiveKit swap lands inside an already-stable shell. One surgery at a time. Gate 3.0 sits at the very front so the riskiest UX assumption is judged in the flesh before any build effort.
- **App cutover last** (Phase 5): it's the piece with the most external pointers (Twilio, auth, kiosk links) — do it once everything it hosts is already proven on the box.
