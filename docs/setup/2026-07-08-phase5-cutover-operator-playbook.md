# Phase-5 cutover — operator playbook (do-this, step-by-step)

> **✅ EXECUTED 2026-07-09 — the pilot is LIVE on the box.** This playbook ran end-to-end (Parts 0–11); R1 cleared; two-way audio + video + push verified live. Post-cutover status, the login-fix lesson, tracked bug, and next-session agenda: **`docs/handoffs/2026-07-09-cutover-executed-live-handoff.md`.**

**Written:** 2026-07-08 · **This is the "how + where" companion to the runsheet.** The runsheet (`docs/setup/2026-07-08-phase5-cutover-runsheet.md`) is the *why/reference*; **this doc is the click-by-click checklist you execute.** Do the parts in order. Every console/command is spelled out. `⟨CONFIRM⟩` = a value you read from a console in Part 0.

**Golden rule for the app config (Part 4–5):** the box already runs a **working staging** portal + kiosk on Coolify. **Mirror the staging apps and prod-ify the values** — don't rebuild config from scratch. Staging proves CORS + push + captions + video already work with this exact wiring; copying it (same variable names, same "Build Variable" flags) is what guarantees prod behaves.

**Nothing you do in Parts 1–9 touches the live pilot.** The pilot keeps running on Vercel until Part 11 (go-live). You can stop after any part and resume later.

**Where to sign in (have these open):**
| Console | URL | Login |
|---|---|---|
| Terminal (Mac) | — | SSH key `~/.ssh/lc_box` |
| DigitalOcean | https://cloud.digitalocean.com | kthakkar.1983@gmail.com (2FA) |
| Coolify | https://coolify.lobby-connect.com | admin (PM) + 2FA |
| Cloudflare | https://dash.cloudflare.com | your account (2FA) — zone `lobby-connect.com` |
| Twilio | https://console.twilio.com | Lobby Connect – Pilot project |
| Supabase (prod) | https://supabase.com/dashboard/project/ztunzdpmazwwwkxcpyfp | your account |
| Vercel | https://vercel.com/kumar-thakkars-projects | (to read prod env values) |
| Password manager | — | the `lc_prod` LiveKit secret, RustDesk creds, KIOSK_CONFIG_SECRET backup |

---

## PART 0 — Gather the console-only values (≈30 min, do first)

Fill these in before touching anything. They're the `⟨CONFIRM⟩` values the runsheet flags.

### 0.1 — Twilio (the pilot number + its current webhooks)
1. Twilio console → **Phone Numbers → Manage → Active numbers** → click the pilot number.
2. Record:
   - [ ] **Pilot DID (E.164):** `+14058750410`
   - [ ] **Voice — "A CALL COMES IN"** URL + method (should be `POST https://lobby-connect-portal.vercel.app/api/twilio/voice/incoming`): `______YES________`
   - [ ] **Call status changes** (statusCallback) URL + method (should be `POST …/api/twilio/voice/status`): `_______YES_______`
   - [ ] Any Messaging webhook set? (expected: none): `______NONE________`
3. Also grab the **Auth Token** (Account → API keys & tokens) — you'll confirm it matches the box env. Keep it in PM, don't paste it anywhere. - Done

### 0.2 — Supabase Auth (current URLs)
1. Supabase prod → **Authentication → URL Configuration**.
2. Record:
   - [ ] **Site URL** (expected `https://lobby-connect-portal.vercel.app`): `______YES________`
   - [ ] **Redirect URLs** allowlist (all entries): `_______NO SUCH OPTION - BUT .DOMAIN.COM ALLOWED_______`

### 0.3 — The LiveKit `lc_prod` secret (from the box, not Vercel)
The `lc_prod` LiveKit key/secret is **NOT on Vercel** (the standby froze before Phase 4). Read it from the box:
```bash
ssh -i ~/.ssh/lc_box root@159.203.124.112 "cat /opt/livekit/livekit.yaml"
```
- [ ] Find the `keys:` block → the **`lc_prod:`** entry → record its API key name (`lc_prod`) and secret string. (Also in PM under "LC LiveKit API keypairs".)

### 0.4 — All Vercel prod env VALUES (to copy into Coolify)
Pull them to `.env.production.local` in each app dir — that filename matches the repo's `.env.*.local` gitignore rule, so git won't track the secrets:
```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect/apps/portal" && vercel env pull .env.production.local --environment=production
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect/apps/kiosk"   && vercel env pull .env.production.local --environment=production
```
- [ ] Both files written and hold every prod value. Sanity-check they're ignored: `git status --short` shows nothing for them. - RAN BOTH COMMANDS FILES DOWNLOADED

> **⚠ Delete both after Part 5** — they contain live secrets. See the delete command at the end of Part 5.

---

## PART 1 — Snapshot the box (2 min)

So you can restore if anything goes sideways during stand-up.
- **DO console:** Droplets → `lc-box-1` → **Snapshots → Take snapshot** → name `pre-phase5-cutover`. - DONE
- Or CLI: `doctl compute droplet-action snapshot 581936683 --snapshot-name pre-phase5-cutover`
- [ ] Snapshot started (takes a few min in the background; you can proceed).

---

## PART 2 — Apply migrations 0019 + 0020 to prod Supabase (5 min)

Prod is at **0018**; you're adding two strictly-additive tables (safe — the Vercel standby ignores them).

**Easiest (recommended):** ask Claude to apply them via the Supabase MCP `apply_migration` against `ztunzdpmazwwwkxcpyfp` (records the version in the migrations ledger properly, same as staging). Say: *"apply 0019 and 0020 to prod."*

**Manual fallback (Supabase dashboard):**
1. Supabase prod → **SQL Editor → New query**.
2. Paste the full contents of `supabase/migrations/0019_push_subscriptions.sql`, **Run**.
3. New query → paste `supabase/migrations/0020_property_remote_access.sql`, **Run**.
   *(Note: the SQL-editor path creates the tables but doesn't register the version in the migrations ledger — the MCP path is cleaner. Either way the tables exist, which is what the app needs.)*

**Verify:**
- [x] Applied via Supabase MCP 2026-07-09. Ledger now ends `20260709013030_push_subscriptions` + `20260709013048_property_remote_access` (= prod at 0020). Both tables exist with correct RLS/FKs; security advisor clean (only the intentional D14 no-policy INFO + pre-existing WARNs).

---

## PART 3 — Create the DNS records (Cloudflare, 3 min)

Straight-to-box: point the real prod hostnames at the box now, so DNS + TLS are proven days before go-live. Nobody uses them yet.
1. Cloudflare → zone **`lobby-connect.com`** → **DNS → Records → Add record** (do this twice):

| Type | Name | IPv4 address | Proxy status | TTL |
|---|---|---|---|---|
| A | `app` | `159.203.124.112` | **DNS only (grey cloud)** | Auto (or 60s during cutover) |
| A | `kiosk` | `159.203.124.112` | **DNS only (grey cloud)** | Auto |

> ⚠ **Proxy status must be "DNS only" (grey cloud), not "Proxied" (orange).** Same as the existing `staging`/`coolify` records. Orange-cloud would break Traefik's Let's Encrypt + the WebSocket/media paths.

**Verify:**
- [ ] `dig +short app.lobby-connect.com` → `159.203.124.112` (may take a minute). Same for `kiosk.`.

---

## PART 4 — Create the two prod apps in Coolify (15 min)

Open Coolify → project **`lobby-connect`**. Create a **new environment** for prod so it's cleanly separated from staging.

### 4.1 — New environment
- In the `lobby-connect` project, **add an Environment** named **`production`** (button is usually near the environment tabs).
- [ ] Environment `production` exists.

### 4.2 — Portal app (`lc-portal-prod`)
1. In `production` → **+ New / Add Resource** → **Application → Private Repository (via GitHub App)** → pick `kthakkar1983/lobby-connect`, **branch `main`**.
2. **Build Pack = Dockerfile.** Set:
   - **Dockerfile Location:** `/apps/portal/Dockerfile`
   - **Base Directory / Build Context:** `/` (repo root)
   - **Ports Exposes:** `3000`
3. **Name it `lc-portal-prod`.**
4. **Domains:** set to `https://app.lobby-connect.com`.
5. **⚠ Do NOT add basic-auth labels.** Prod is public (Twilio + the kiosk must reach it un-challenged). Leave the "Readonly" labels toggle **unchecked** but add **no** `lc-*-auth` middleware — unlike staging, prod has no front-door password. The three staging carve-outs don't apply.
6. **⚠ Turn OFF auto-deploy for now** (app → Settings → toggle "Auto Deploy" off, or disable the webhook). You'll enable it after the env is set, so a stray `main` push or the `gen:types` commit doesn't deploy a half-configured app.
7. **Do NOT deploy yet** — set env first (Part 5).
- [ ] `lc-portal-prod` created, domain `app.lobby-connect.com`, port 3000, auto-deploy OFF, not yet deployed.

### 4.3 — Kiosk app (`lc-kiosk-prod`)
Same flow:
- Repo `lobby-connect`, branch `main`, Dockerfile Location `/apps/kiosk/Dockerfile`, Base Directory `/`, **Ports Exposes `80`** (kiosk is nginx).
- Name `lc-kiosk-prod`, Domain `https://kiosk.lobby-connect.com`, no basic auth, auto-deploy OFF, don't deploy yet.
- [ ] `lc-kiosk-prod` created.

---

## PART 5 — Set the prod env vars (20 min) — MIRROR STAGING

> **Code-grounded evidence for every var below (build vs runtime, `file:line`, R1):** `docs/setup/2026-07-09-part5-env-codegrounded.md`. Read it if any value is ambiguous.

**Method:** open the **staging** app's env as a reference, replicate every variable on the prod app with the **same "Build Variable" flags**, substituting prod values. This guarantees the build-time vs runtime split is right (CORS/`KIOSK_ORIGIN`, VAPID, etc.) without you having to reason about it.

> **⚠ Coolify UI note (2026-07-09):** the current UI replaced the single **"Build Variable"** checkbox with **two** — **"Available at Buildtime"** and **"Available at Runtime."** **"Build Variable" = check "Available at Buildtime."** A `NEXT_PUBLIC_*`/`KIOSK_ORIGIN`/VAPID-public var that's *also* read server-side needs **both** checked (the run stage is a fresh image that doesn't inherit build ENV, so server-side `process.env` reads need Runtime too). Pure runtime secrets = **Runtime only**. The explicit per-var Buildtime/Runtime grid is in the portal table below.

### 5.1 — Portal env
1. Coolify → `lc-portal-staging` → **Environment Variables** — leave this open as the template (note which vars are flagged **Build Variable**).
2. Coolify → `lc-portal-prod` → **Environment Variables** → add each variable. Values come from your Part 0.4 `apps/portal/.env.production.local` file (Vercel prod values), with this **transform**:

| Variable(s) | Value on box-prod | Build var? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | **same as Vercel** (shared prod DB) | first two = build |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_PHONE_NUMBER`, `EMERGENCY_DIAL_NUMBER` | **same as Vercel** (`TWILIO_AUTH_TOKEN` MUST match — else webhooks 403) | runtime |
| ~~`AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`~~ | **DO NOT ADD** — box trunk has Agora stripped | — |
| `LIVEKIT_URL` | `wss://livekit.lobby-connect.com` | runtime |
| `LIVEKIT_API_KEY` | `lc_prod` | runtime |
| `LIVEKIT_API_SECRET` | ⟨from Part 0.3 — livekit.yaml/PM, **not Vercel**⟩ | runtime |
| `SPEECHMATICS_API_KEY` | **same as Vercel** (captions — must be present) | runtime |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_READ_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | **same as Vercel** | `NEXT_PUBLIC_SENTRY_DSN` = build |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | **same as Vercel** (already on Coolify staging — reuse) | match the staging flags |
| `CRON_SECRET` | **copy from `lc-portal-staging` (= the `lc-ops` value), NOT Vercel** — the Vercel pull returns it EMPTY, and the box crons are driven by `lc-ops` (Part 7), which must match. | runtime |
| `KIOSK_CONFIG_SECRET` | **same as Vercel — byte-identical** (signed kiosk links) | runtime |
| `NEXT_PUBLIC_APP_URL` | **`https://app.lobby-connect.com`** (RETARGET) | **build** |
| `KIOSK_ORIGIN` | **`https://kiosk.lobby-connect.com`** (RETARGET) | **⚠ must be right at build** — bakes the `/api/kiosk` + `/api/video` CORS header; wrong = kiosk + video break |
| *(Anything else present on staging that's not listed here)* | copy from staging with its flag | — |

> `VIDEO_PROVIDER` — **do not add.** It was removed with Agora; it's a dead env now.

> **⚠ The two silent-failure build vars (code-verified 2026-07-09).** `apps/portal/Dockerfile` threads `ARG` lines only for `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY/APP_URL/SENTRY_DSN`. It does **NOT** `ARG` **`KIOSK_ORIGIN`** or **`NEXT_PUBLIC_VAPID_PUBLIC_KEY`** — those two reach `next build` *solely* because Coolify injects Build-Variable-flagged env into the build step (proven: the `main`-identical staging build bakes the correct CORS origin with the same ARG-less Dockerfile). **So both MUST carry the Coolify "Build Variable" flag** — if either is set runtime-only the build is clean but the browser is broken, with **no error in any log**:
> - `KIOSK_ORIGIN` runtime-only → CORS bakes as `http://localhost:5173` → **kiosk pairing + all video CORS-blocked** (Part 9 step 4 curl catches this).
> - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` runtime-only → `armPush()` returns false → **web-push OS alerting silently dead**, and *no smoke step catches it unless you actively arm push* (Part 9 step 5 now does).
>
> **Do NOT set `BUILD_STANDALONE`** — it's hardcoded `ENV BUILD_STANDALONE=1` in `apps/portal/Dockerfile:26` (do not confuse with the per-agent note; the Dockerfile owns it).

### 5.2 — Kiosk env
On `lc-kiosk-prod` → Environment Variables (mirror `lc-kiosk-staging`):
| Variable | Value | Build var? |
|---|---|---|
| `VITE_PORTAL_API_URL` | **`https://app.lobby-connect.com`** (RETARGET) | build (VITE_) |
| `VITE_SENTRY_DSN` | same as Vercel kiosk | build |
| *(any other VITE_ on staging)* | copy | build |

> The kiosk needs **no** `LIVEKIT_*` — it gets the LiveKit URL from the portal's `/api/video/token` at runtime.

- [ ] Portal + kiosk env sets match staging's variable list (prod-ified), build flags copied.
- [ ] **Now delete the pulled secret files:** `rm "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect/apps/portal/.env.production.local" "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect/apps/kiosk/.env.production.local"`

---

## PART 6 — First deploy + watch (10 min)

1. `lc-portal-prod` → **Deploy**. Watch **Deployments → (the running one) → build logs**.
   - If the portal build dies at **"Collecting build traces"** (OOM), just **Redeploy** — it usually clears. If it recurs, bump box swap 2→4 GB (`fallocate`/`swapon`; see box-ops-runbook §4/§9) and redeploy.
2. When green, `lc-kiosk-prod` → **Deploy**.
3. Coolify/Traefik auto-issues Let's Encrypt certs for both hosts on first deploy (DNS from Part 3 must resolve first — it does).
- [ ] Both apps deployed "Running"/healthy.
- [ ] Now **re-enable auto-deploy** on both (post-go-live, `main` → box-prod is the deploy path).

---

## PART 7 — Prod crons on `lc-ops` (5 min)

Coolify → `lc-ops` → **Scheduled Tasks** → add two (alongside the existing staging ones):

| Name | Cron (UTC) | Command |
|---|---|---|
| `prod-reaper` | `*/15 * * * *` | `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://app.lobby-connect.com/api/cron/reap-stale-calls` |
| `prod-presence` | `0 8 * * *` | `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://app.lobby-connect.com/api/cron/mark-stale-offline` |

> `lc-ops` already has `CRON_SECRET` in its env (same value as portal). `prod-pg-dump` already exists and already backs up prod — leave it.
- [ ] Both prod tasks added. (The frozen Vercel standby's own daily crons keep firing too — that's fine, everything is idempotent; don't try to stop them.)

---

## PART 8 — Enter the pilot RustDesk credential (3 min)

1. Go to `https://app.lobby-connect.com` → sign in as **admin** → the pilot property → **Remote-access card**.
2. Enter the hotel PC's **peer id** and **unattended password** (from PM). Save.
   - (Blank password on a later Save keeps the existing one; the password is write-only — not re-fetched to the browser.)
- [ ] Card shows the credential exists. (Entered as-is/plaintext at rest — the encryption hardening is a post-cutover / pre-second-hotel task, not now.)

---

## PART 9 — Verify the box AS prod (before any pointer flips) (15 min)

Nobody's pointed at the box yet — prove it works directly.
1. **Cert is production LE (not staging CA):**
   ```bash
   echo | openssl s_client -connect app.lobby-connect.com:443 -servername app.lobby-connect.com 2>/dev/null | openssl x509 -noout -issuer
   ```
   - [ ] Issuer is Let's Encrypt (e.g. `R10`/`R11`/`E5`), **not** anything containing `(STAGING)`.
2. **Sign in** on `https://app.lobby-connect.com` (agent + admin) against prod Supabase; **go on duty**.
3. **Kiosk loads:** `https://kiosk.lobby-connect.com` renders Home.
4. **CORS baked right (the KIOSK_ORIGIN check):**
   ```bash
   curl -sI "https://app.lobby-connect.com/api/kiosk/config" | grep -i access-control-allow-origin
   ```
   - [ ] Returns `access-control-allow-origin: https://kiosk.lobby-connect.com` (NOT `localhost:5173`). If wrong → `KIOSK_ORIGIN` was wrong at build → fix it and **redeploy** the portal (a restart won't fix it).
5. **Migrations live (0019/0020) + VAPID baked right:** from the signed-in portal, **actually arm push** — grant the browser notification permission and confirm it takes (a `push_subscriptions` row appears for your user; ideally a test notification fires). This is the ONLY check that `NEXT_PUBLIC_VAPID_PUBLIC_KEY` was baked at build — a runtime-only misflag makes `armPush()` return false with no error. Also confirm the admin **Remote-access card** loads (no 500 → 0020 live).
6. **Video path:** if feasible, do a test kiosk→agent video call over the box.
7. **Crons:** `/admin/status` shows heartbeats; the `*/15` reaper heartbeat appears within 15 min.
- [ ] All green → the box is a proven prod stack with no live traffic. Go-live is now just the pointer flips.

---

## PART 10 — Rollback rehearsal (do once, quiet moment) (5 min)

Prove the Twilio pointer flips **both** ways before the real cutover (this also de-risks the HMAC host-match — the box's first-ever Twilio call).
1. Twilio console → pilot number → set **both** Voice URLs → `https://app.lobby-connect.com/api/twilio/voice/{incoming,status}`. Save.
2. Call the pilot number yourself → confirm it **answers on the box** (agent on duty there).
   - If it fails (silent/apology/no route): a wrong `Host` (internal name / `:3000`) or missing `X-Forwarded-Proto: https` 403s **identically** to a bad token. **⚠ The app does NOT log the reconstructed URL** — `parseVerifiedTwilioWebhook` returns a bare `"Invalid signature"` 403 (`lib/twilio/client.ts:55`), no Sentry, no URL. So debug from **Traefik's access log** (what `Host`/proto it forwards) or temporarily log `publicUrlFromRequest()` — don't expect the app to print it, and don't jump to blaming `TWILIO_AUTH_TOKEN`. Don't panic; step 3 reverts.
3. Twilio → set both Voice URLs **back to Vercel** (`lobby-connect-portal.vercel.app`). Save. Call again → answers on Vercel.
- [ ] Both directions proven. You now trust the go-live flip + its instant revert.

---

## PART 11 — GO LIVE (daytime, ordered) 🚦

Precondition: Parts 1–10 green, DO snapshot exists, you're on-site with the tablet, phone ready to test-call. **Night-1 is the live test** (relay + video gates); the frozen Vercel standby is your instant rollback.

**Order = prove the sharp, instant-revert pointer first; move the guest tablet only after voice is confirmed.**

0. **Agents on the box:** the on-duty agent signs in at `https://app.lobby-connect.com` and goes on duty.
1. **Twilio (a):** set both Voice URLs → `app.lobby-connect.com` (as in Part 10 step 1). **Immediately call the pilot number.**
   - ✅ answers two-way on the box → **stay** (this call is go-live).
   - ❌ fails → **revert Twilio to Vercel** (Part 10 step 3), debug, retry. Instant, zero pilot cost.
2. Confirm `/admin/status` on the box shows the Twilio webhook heartbeat landing.
3. **Tablet (b)** — only after voice is green: on the pilot tablet, open box-prod admin → re-issue the kiosk config link → point the tablet at `https://kiosk.lobby-connect.com` → reload → confirm Home renders, paired to the pilot property.
4. **Supabase (c)** — last, non-blocking: Supabase → Auth → URL Configuration → **add** `https://app.lobby-connect.com/**` to Redirect URLs (keep the Vercel entry); optionally set Site URL → `https://app.lobby-connect.com`. (Cosmetic for the pilot — don't gate anything on it.)
5. Tell Dilnoza it's live → run the **night-1 smoke** (runsheet §6).
- [ ] Live on the box.

---

## PART 12 — Night-1 + rollback-if-needed

- **Night-1 smoke checklist:** runsheet **§6** — voice, video on the real iPad (Dilnoza's India test calls), captions, push ring behind fullscreen RustDesk, Connect from card + video overlay + **the audio in-call overlay** (never live-tested), duty on/off, call tile + the white-bar dock check, and the **live 933 emergency test** (set `EMERGENCY_DIAL_NUMBER=933` on `lc-portal-prod` → restart → test → **revert to real 911** → restart).
- **RustDesk relay:** Dilnoza working a clean full shift through `relay.lobby-connect.com` = the Phase-2 done-when.

**If something serious breaks — ROLLBACK (minutes):**
1. **Twilio:** both Voice URLs → back to `lobby-connect-portal.vercel.app`. Voice restored instantly.
2. **Tablet:** point back to `https://lobby-connect-kiosk.vercel.app`, reload.
3. **Supabase:** nothing urgent (both origins allowlisted).
The pilot is back on the frozen Vercel/Agora standby, exactly as before. Debug the box offline, retry later.

---

## PART 13 — After a clean ~2-week window → decommission

Runsheet **§8**: close Vercel + Agora, revoke the `lc-claude` tokens, DO auto-backups ON, Supabase Pro, update docs, cut tags. Not now — only after the standby window proves clean.

---

## Quick reference — the numbers you'll reuse

| Thing | Value |
|---|---|
| Box IP | `159.203.124.112` · SSH `ssh -i ~/.ssh/lc_box root@159.203.124.112` |
| Droplet id | `581936683` |
| Prod hosts | `app.lobby-connect.com` (portal) · `kiosk.lobby-connect.com` (kiosk) |
| Standby hosts | `lobby-connect-portal.vercel.app` · `lobby-connect-kiosk.vercel.app` |
| Prod Supabase | `ztunzdpmazwwwkxcpyfp` (at 0018 → apply 0019+0020) |
| LiveKit | `wss://livekit.lobby-connect.com`, key `lc_prod` |
| RustDesk relay | `relay.lobby-connect.com` |
| Coolify | `https://coolify.lobby-connect.com`, project `lobby-connect`, new env `production` |
