# Box ops runbook — lc-box-1 (NYC3)

The India-maintainer artifact: everything needed to operate the box without this repo's history. Filled in as Phase 1 was actually executed (2026-07-02 →). Spec: `docs/specs/2026-07-02-phase1-box-domain-staging-design.md` · Plan: `docs/plans/2026-07-02-phase1-box-domain-staging.md`.

## 1. What runs where

| Thing | Where | URL |
|---|---|---|
| Coolify (deploy console) | lc-box-1 | https://coolify.lobby-connect.com |
| Staging portal | Coolify app (Dockerfile `apps/portal/Dockerfile`, branch `staging`) | https://staging.lobby-connect.com |
| Staging kiosk | Coolify app (Dockerfile `apps/kiosk/Dockerfile`, branch `staging`) | https://staging-kiosk.lobby-connect.com |
| Ops container (crons + prod backup) | Coolify app (Dockerfile `ops/Dockerfile`) | no domain |
| Staging DB/auth | Supabase project `cgtvqjxhbojztzumshca` (managed, free) | supabase.com dashboard |
| Prod DB/auth | Supabase project `ztunzdpmazwwwkxcpyfp` (managed, free) — prod APP still on Vercel until Phase 5 | supabase.com dashboard |
| DNS | Cloudflare zone `lobby-connect.com` — infra hosts grey-cloud/DNS-only | dash.cloudflare.com |

## 2. Access

> Full account/credential register (every login, token, key, where each secret lives, revocation checklist): `docs/setup/2026-07-03-accounts-credentials-inventory.md`.

- **SSH:** `ssh -i ~/.ssh/lc_box root@<droplet-IP>` (key generated 2026-07-02, lives only on Kumar's Mac; passphrase-less). Password auth is OFF. Port 22 is firewalled to Kumar's static IP — if his IP ever changes: DO console → Networking → Firewalls → `lc-box-fw` → edit the 22/tcp source.
- **Coolify UI:** admin account (password manager) + 2FA.
- **DO console/API:** Kumar's account; the provisioning API token should be revoked/rotated after Phase-1 build (DO console → API).
- **Coolify API token** (`lc-claude`, root permissions, created for the Phase-1 build): revoke alongside the DO token after the build (Coolify → Keys & Tokens → API tokens). Day-2 ops work fine through the UI.
- **Coolify first-boot access** (before the instance domain existed): SSH tunnel `ssh -i ~/.ssh/lc_box -L 8000:localhost:8000 root@<IP>` → http://localhost:8000. Same trick works if Traefik is ever broken.
- **Coolify instance secrets** (`/data/coolify/source/.env`): backed up in Kumar's password manager (2026-07-03). Re-copy after any Coolify major upgrade.
- **Break-glass order:** DO console Recovery Console → SSH → Coolify UI.

## 3. Provisioning record (as executed 2026-07-02)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/lc_box -N "" -C "kumar-lc-box"
doctl compute ssh-key create lc-box-key --public-key "$(cat ~/.ssh/lc_box.pub)"
#   → key ID 57536116, fingerprint c2:f6:20:b3:a3:f0:0c:02:44:81:0b:32:1d:c1:bb:3a

doctl compute droplet create lc-box-1 \
  --region nyc3 --size s-4vcpu-8gb --image ubuntu-24-04-x64 \
  --enable-ipv6 --enable-monitoring \
  --ssh-keys 57536116 --wait
#   → droplet ID 581936683
#   → IPv4 159.203.124.112 · IPv6 2604:a880:800:14:0:3:316e:3000

doctl compute firewall create --name lc-box-fw \
  --inbound-rules "protocol:tcp,ports:22,address:70.184.31.21/32 protocol:tcp,ports:80,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:443,address:0.0.0.0/0,address:::/0 protocol:icmp,address:0.0.0.0/0,address:::/0" \
  --outbound-rules "protocol:tcp,ports:all,address:0.0.0.0/0,address:::/0 protocol:udp,ports:all,address:0.0.0.0/0,address:::/0 protocol:icmp,address:0.0.0.0/0,address:::/0" \
  --droplet-ids 581936683
#   → firewall ID b25a8033-2af7-47ec-9ba4-761bb0400c7a
#   → 22/tcp restricted to Kumar's static Cox IP 70.184.31.21
```

DNS (Cloudflare zone `lobby-connect.com`, all **DNS-only/grey-cloud**): `coolify`, `staging`, `staging-kiosk` → A → `159.203.124.112`.

## 4. Hardening record (as executed 2026-07-02)

```bash
# all as root on lc-box-1; DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
# (first boot: cloud-init holds the dpkg lock — use -o DPkg::Lock::Timeout=600)
apt-get -o DPkg::Lock::Timeout=600 -q update && apt-get -o DPkg::Lock::Timeout=600 -yq upgrade
apt-get -o DPkg::Lock::Timeout=600 -yq install fail2ban ufw unattended-upgrades

timedatectl set-timezone UTC
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo "/swapfile none swap sw 0 0" >> /etc/fstab

# SSH key-only (verify a NEW session still connects before closing the old one)
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' > /etc/ssh/sshd_config.d/60-lc.conf
systemctl restart ssh

ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
systemctl enable --now fail2ban          # default sshd jail active

# security patches auto-apply; reboots only at 17:00 UTC (noon OKC / 22:30 IST —
# outside US hotel nights ≈ 03:00–15:00 UTC)
printf 'Unattended-Upgrade::Automatic-Reboot "true";\nUnattended-Upgrade::Automatic-Reboot-Time "17:00";\n' > /etc/apt/apt.conf.d/52lc-reboot

reboot   # once, post-upgrade; verified swap/ufw/fail2ban persist
```

DO email alerts (to kthakkar.1983@gmail.com, created via `doctl monitoring alert create`): disk >80% (10m) · memory >90% (10m) · CPU >90% (10m).

## 5. Coolify how-tos

**Layout:** project `lobby-connect` → environment `staging` → three apps:

| App | uuid | Source |
|---|---|---|
| `lc-portal-staging` | `lg2rzpmcxrxistxou7h07fd0` | repo branch `staging`, Dockerfile `apps/portal/Dockerfile` |
| `lc-kiosk-staging` | `ziqzypp2wokei0adv10o6vze` | same branch, `apps/kiosk/Dockerfile` |
| `lc-ops` | `su8p4jpng7izpzl7e7sw4k8o` | same branch, `ops/Dockerfile`; no domain; volume `/data/lc-backups`↔`/backups` |

- **Deploy:** app → Deploy button (or push to `staging` — the GitHub App `lc-coolify` webhooks auto-deploy). API: `POST /api/v1/deploy?uuid=<app>`.
- **Env change:** app → Environment Variables. Vars flagged **Build Variable** (`NEXT_PUBLIC_*`, `VITE_*`) are baked into the image → need a redeploy; runtime vars need only a **Restart**. The "latest config not applied" banner means exactly that. **Quirk:** every key shows a second `is_preview=true` row — those apply only to PR-preview deploys (unused); ignore them.
- **Secrets discipline:** `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `KIOSK_CONFIG_SECRET`, `PROD_DB_URL` were pasted by Kumar directly in the UI (values in his password manager); everything non-secret was set via API.
- **Logs:** app → Logs (runtime) or Deployments → click a deployment (build). On the host: `docker logs <container>` (names start with the app uuid).
- **Rollback:** app → Deployments → previous successful deployment → Redeploy. (Images are on the box; rollback is a re-tag, fast.)
- **Scheduled tasks:** on `lc-ops` → Scheduled Tasks — run history + output per execution lives there.

## 6. Cron + backup matrix

| Job | Schedule (UTC) | What it does |
|---|---|---|
| `staging-reaper` | `*/15 * * * *` | `GET /api/cron/reap-stale-calls` on staging with `Authorization: Bearer $CRON_SECRET` |
| `staging-presence` | `0 8 * * *` | `GET /api/cron/mark-stale-offline` on staging, same auth |
| `prod-pg-dump` | `0 13 * * *` | `/usr/local/bin/backup.sh` in the ops container → `/backups` volume |

## 7. Backup + restore drill

- **What the dump covers:** `public` (app data) + `auth` (users) + `storage` (object metadata) schemas of PROD, `pg_dump -Fc --no-owner --no-privileges`, as role `lc_backup` (read-only + BYPASSRLS; never the master password).
- **Known gap:** Storage BINARIES (playbook PDFs) are not in `pg_dump` — they live in Supabase Storage's object store. Accepted: playbooks are re-uploadable by owners.
- **Retention:** newest 14 dumps on the `/backups` volume (= host `/data/lc-backups`).
- **Connection:** IPv6 direct to `db.ztunzdpmazwwwkxcpyfp.supabase.co:5432` — worked first try from the droplet (IPv6 enabled at creation). If it ever breaks, the session-pooler IPv4 fallback is `postgres://lc_backup.ztunzdpmazwwwkxcpyfp:<pw>@<pooler-host>:5432/postgres` (pooler host shown in Supabase dashboard → Connect).
- **Role facts (as built 2026-07-03):** prod is PostgreSQL 17.6; `create role lc_backup login password '…' bypassrls` + `grant pg_read_all_data` ran cleanly in the dashboard SQL editor (no fallback needed). `BYPASSRLS` is required — without it `pg_dump` errors on RLS-enabled tables.
- **Restore drill (run quarterly + after any backup change):** `ops/restore-drill.sh <dump>` on the box host; PASS = `public.calls` + `auth.users` counts match prod (check prod counts in the Supabase dashboard SQL editor). **First drill 2026-07-03: PASS** — dump `prod-20260703-031334.dump` (240 KB) restored; `calls=225`, `auth.users=5`, exact match; 22 ignored `pg_restore` errors, all storage-policy/ACL class (expected — scratch container lacks Supabase-managed roles).

## 8. Incidents ("staging is down")

1. `https://staging.lobby-connect.com` unreachable → check Coolify UI → app → Logs / Deployments (redeploy or rollback).
2. Coolify itself unreachable → SSH in; `docker ps | grep coolify`; `systemctl status docker`; disk full? `df -h` (dumps live on `/backups` — prune if needed).
3. Staging Supabase paused (free tier, ~7 days idle — should NOT happen with the `*/15` cron traffic) → Supabase dashboard → un-pause.
4. DO alert emails (disk/CPU/memory) → SSH + `htop`, `df -h`; vertical resize is §9.
5. Box dead entirely → it's staging; rebuild from this runbook + git (≈1–2 h). Prod is unaffected (Vercel + Supabase).

## 9. Snapshot + resize

- **Snapshot before every migration phase:** DO console → Droplets → lc-box-1 → Snapshots → Take snapshot (or `doctl compute droplet-action snapshot <id> --snapshot-name pre-phase-N`).
- **Vertical resize:** power off → Resize (CPU/RAM-only preserves disk) → power on. ~2 min downtime; do it daytime UTC.

## 10. Basic auth (staging front door)

- One shared user `staging`; bcrypt hash lives in a Traefik label on both apps (Coolify → app → Advanced → Container Labels), NOT in the repo.
- **Carve-outs (bypass basic auth), and why:** `/api/kiosk/*` (kiosk HMAC token protects it; the kiosk fetches cross-origin and cannot answer a browser basic-auth challenge), `/api/agora/*` (same cross-origin kiosk caller; route has its own dual auth), `/api/cron/*` (`CRON_SECRET` bearer; called by the ops container).
- **Rotate the password:** generate a new hash `docker run --rm httpd:2.4-alpine htpasswd -nbB staging '<new-pw>'`, double every `$` → `$$`, replace in both apps' labels, redeploy.
- **As-built label anatomy (2026-07-03):** portal https router `https-0-lg2rzpmcxrxistxou7h07fd0` carries `middlewares=gzip,lc-staging-auth`; the bypass router `lc-portal-carveouts` (priority 100, same service, NO auth middleware) matches the three carve-out path prefixes. Kiosk has its own independently-named `lc-staging-auth-kiosk` middleware (same hash) so a portal redeploy can never break the kiosk router. Verified 2026-07-03: anon → 401+Basic on both hosts; all three carve-outs answer with app-level auth, no Basic challenge.

## 11. Seams (later phases)

- **Phase 2 (RustDesk relay):** will open 21115/tcp, 21116/tcp+udp, 21117/tcp on the DO firewall + ufw (web-client ports 21118/21119 stay CLOSED).
- **Phase 3:** agent-machine SOP (dedicated Chrome profile, notification settings) gets its own section here.
- **Phase 4 (LiveKit):** TURN 5349/tcp + 3478/udp or second IP — decide at build.
- **Phase 5 (prod cutover):** enable DO weekly auto-backups; move prod apps here; Twilio webhook URLs + Supabase Auth URLs + kiosk links + Sentry origins all repoint (checklist in the migration plan).
