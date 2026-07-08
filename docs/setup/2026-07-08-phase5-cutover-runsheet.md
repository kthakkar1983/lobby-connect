# Phase-5 blue-green cutover runsheet + rollback rehearsal

**Written:** 2026-07-08 · **Owns:** the executable cutover from the frozen Vercel/Agora standby to the owned box (Coolify + self-hosted LiveKit) — migration-plan Phase 5, steps 5–10.
**Master plan:** `docs/plans/2026-07-01-stack-consolidation-migration.md` (Phase 5) · **Box ops:** `docs/setup/2026-07-02-box-ops-runbook.md` · **Accounts:** `docs/setup/2026-07-03-accounts-credentials-inventory.md`.
**→ Do-this operator playbook (click-by-click companion): `docs/setup/2026-07-08-phase5-cutover-operator-playbook.md`.** This runsheet is the *why/reference*; the playbook is the *hands-on checklist*.

> **Sourcing:** every value below is either **source-backed** (quoted from a repo doc / verified by a live tool call — marked inline) or flagged **⟨CONFIRM⟩** = the literal value lives only in a live console (Twilio / Supabase / Sentry / Vercel / Coolify) and MUST be read there before go-live, not guessed. Nothing here is invented.

## Two decisions locked (2026-07-08, Kumar)

1. **Pointer model = STRAIGHT-TO-BOX.** `app.` / `kiosk.` DNS is created pointing at the **box during stand-up** (so DNS + TLS are proven days early). Go-live flips **only** three things that are *not* DNS: **(a) Twilio webhook URLs, (b) the pilot tablet's kiosk bookmark, (c) Supabase Auth URLs.** No DNS change at the tense moment → voice rollback is an instant Twilio-webhook revert; kiosk rollback = re-point the on-site tablet (seconds). *(This is a deliberate, Kumar-approved simplification of the plan-of-record step 6, which pointed the domains at Vercel first. Reason: Vercel currently has **zero custom domains** — `vercel domains ls` → 0 — so the plan-of-record path would first require adding `app.`/`kiosk.` onto the frozen Vercel projects; straight-to-box avoids that and shrinks the go-live pointer set.)*
2. **Night-1 includes a live 933 emergency test on the box** (the 911 conference path has never run through the box's Twilio+Traefik). See §6.

---

## 0. Preflight facts (source-backed)

| Thing | Value | Source |
|---|---|---|
| Box | `lc-box-1`, DO NYC3, **IPv4 `159.203.124.112`**, IPv6 `2604:a880:800:14:0:3:316e:3000` | box-ops-runbook §3 |
| SSH | `ssh -i ~/.ssh/lc_box root@159.203.124.112` (key on Kumar's Mac only; port 22 firewalled to `70.184.31.21/32`) | box-ops-runbook §2–3 |
| Coolify | `https://coolify.lobby-connect.com`, project **`lobby-connect`**, existing env `staging` | box-ops-runbook §5 |
| Staging apps (do NOT touch) | `lc-portal-staging` `lg2rzpmcxrxistxou7h07fd0` · `lc-kiosk-staging` `ziqzypp2wokei0adv10o6vze` · `lc-ops` `su8p4jpng7izpzl7e7sw4k8o` | box-ops-runbook §5 |
| DNS zone | `lobby-connect.com` on **Cloudflare** (registrar + DNS); infra hosts are **DNS-only / grey-cloud** A → `159.203.124.112` | box-ops-runbook §3 |
| LiveKit | `livekit.lobby-connect.com`, v1.13.3 at `/opt/livekit/`, keypairs **`lc_prod`** + `lc_staging` in `livekit.yaml` | box-ops-runbook §13 |
| RustDesk relay | `relay.lobby-connect.com`, hbbs/hbbr `1.1.15` at `/opt/rustdesk/`, key-enforced; **property-agnostic — no cutover change** | box-ops-runbook §12 |
| Nightly prod backup | `lc-ops` cron `prod-pg-dump` `0 13 * * *` → `/data/lc-backups` (14-day); already dumps prod DB; **unaffected by the app cutover** | box-ops-runbook §6–7 |
| **Prod Supabase** | ref **`ztunzdpmazwwwkxcpyfp`** (lobby-connect-prod, us-east-1, ACTIVE_HEALTHY) | **verified via `list_projects` 2026-07-08** |
| **Prod migration high-water** | **`0018_realtime_calls_authz`** → **0019 + 0020 NOT yet applied** | **verified via `list_migrations` 2026-07-08** |
| Vercel standby (frozen) | portal `dpl_7PQ1P7Ui41UD8wrpZrV3FZ2koj6y` · kiosk `dpl_FxZhsJQVLEUn5V2M81gBwvKch5Mu`, both `main@f4af480`, aliased `lobby-connect-portal.vercel.app` / `lobby-connect-kiosk.vercel.app`; repo git-DISCONNECTED from both projects | migration-plan step 1 |

---

## 1. Standby invariants — the laws that keep rollback valid

The frozen Vercel/Agora deployment is a **valid instant-rollback target only while all of these hold**. Both stacks point at the *same* prod Supabase; the DB is the shared spine and must never diverge in a way old code can't tolerate.

1. **Migrations stay ADDITIVE-ONLY.** No drop/rename/narrowing while the standby lives — old Agora code must keep working by *ignoring* new tables. (0019 + 0020 are pure `create table`; safe.)
2. **The prod DB never forks.** Both stacks → `ztunzdpmazwwwkxcpyfp`. There is never a second prod DB.
3. **`agora_channel_name` is NOT renamed.** The LiveKit trunk reads/writes this exact column byte-identically; the standby needs it too. (The optional `→ video_room_name` rename is decommission-only.)
4. **Vercel `AGORA_*` envs stay** on Vercel until decommission — the standby needs them. **Do NOT copy them to the box** (the box trunk has Agora stripped and never reads them).
5. **The Agora account stays open** until decommission.
6. **`KIOSK_CONFIG_SECRET` is byte-identical** on box-prod and Vercel — signed kiosk config links minted by either stack must validate on the other, so the tablet survives the swap in both directions.
7. **Vercel prod stays frozen & untouched** during the window — no redeploys, no env edits, no git reconnect. Reversal (only if ever abandoning the box) = `vercel git connect` per project.

---

## 2. Stand-up (pre-go-live — ZERO pilot impact)

Everything here is done **before** any pointer flips. The pilot keeps running on Vercel the entire time. Do it daytime.

**Snapshot first:** take a DO snapshot of `lc-box-1` (label `pre-phase5-cutover`) before standing up prod apps.

### 2.1 — Apply migrations 0019 + 0020 to prod Supabase
Prod is at **0018** (verified). Apply exactly two, in order:
```
supabase/migrations/0019_push_subscriptions.sql   # Web Push endpoints (RLS own-row; service-role writes)
supabase/migrations/0020_property_remote_access.sql # RustDesk per-property creds (RLS zero-policy + REVOKE; D14)
```
Both are strictly additive → safe with the standby live (invariant 1). Apply via the Supabase MCP `apply_migration` against `ztunzdpmazwwwkxcpyfp`, or dashboard SQL editor. **Re-confirm `list_migrations` shows 0018 present before applying** (don't re-apply). After: `pnpm gen:types` + commit (0020 needs no `supabase-types.ts` overlay — no CHECK columns).

> **⚠ ORDERED GATE (do NOT reorder):** 0019 + 0020 must be applied to prod **before the first `lc-portal-prod` deploy**. The LiveKit trunk reads `push_subscriptions` (0019) and `property_remote_access` (0020); a box serving that code against a prod DB still at 0018 → **500s on push registration and the remote-access route**. Confirm via `list_migrations` that prod is at 0020, then deploy.
> **⚠ The `pnpm gen:types` commit lands on `main`** — which `lc-portal-prod` tracks. If Coolify auto-deploy is enabled, that commit **redeploys prod**. Push it while auto-deploy is OFF (§2.3), or accept the redeploy.

### 2.2 — DNS: create `app.` + `kiosk.` → box (straight-to-box)
Add to Cloudflare zone `lobby-connect.com`, **DNS-only (grey cloud)**, same pattern as the existing `staging`/`coolify` records:

| Type | Name | Target | Proxy | TTL |
|---|---|---|---|---|
| A | `app` | `159.203.124.112` | DNS only | low (e.g. 60s) while cutting over |
| A | `kiosk` | `159.203.124.112` | DNS only | low |

Once these resolve, Coolify/Traefik will mint Let's Encrypt certs for both hosts on first prod-app deploy (§2.3). **Nobody is pointed at these hostnames yet** (tablet still on `*.vercel.app`, Twilio still on Vercel), so the box serving prod behind them early is harmless — it just gets DNS + TLS proven ahead of go-live.

### 2.3 — Coolify prod apps
Create a **new environment `production`** under project `lobby-connect` (clean separation from `staging`; recommended), with two apps mirroring the staging build config:

| App | Build | Port | Domain | Branch |
|---|---|---|---|---|
| `lc-portal-prod` | Dockerfile `apps/portal/Dockerfile`, context `/`, `BUILD_STANDALONE=1` | 3000 | `app.lobby-connect.com` | `main` |
| `lc-kiosk-prod` | Dockerfile `apps/kiosk/Dockerfile`, context `/` | 80 | `kiosk.lobby-connect.com` | `main` |

- **Prod is PUBLIC — NO Traefik basic-auth middleware** on either prod router (staging's basic-auth wall exists only to keep the preview private; prod must be openly reachable, and Twilio/kiosk *must* reach it un-challenged). Do not attach `lc-*-auth`; the three staging carve-outs (`/api/kiosk`, `/api/agora`, `/api/cron`) are therefore moot on prod.
- **Auto-deploy caution:** apps track `main`. Post-go-live, `main` → box-prod is the intended deploy path. **During stand-up, disable auto-deploy** (or expect a redeploy on any `main` push) until the env is fully populated and verified, then enable.
- Coolify build-vs-runtime: `NEXT_PUBLIC_*` and `VITE_*` are **build variables** (baked into the image → require a **redeploy** to change); everything else is runtime (a **restart** suffices). Paste secrets in the UI, never via API/chat. Leave the "Readonly" labels toggle **unchecked**.

### 2.4 — Prod env (copy the FULL Vercel list, then transform)
**Copy EVERY prod env var from the two Vercel projects — do not count, do not rebuild from memory** (this is the `SPEECHMATICS_API_KEY`-broke-captions lesson; a fixed count invites stopping early and dropping one). Values are ⟨CONFIRM⟩ (read from Vercel prod). Then apply the transform below. **Note on LiveKit:** the three `LIVEKIT_*` vars are **NOT on Vercel prod** (the standby froze 2026-07-06, *before* Phase 4 merged, so `lc_prod` never reached Vercel) — do not expect to copy them; take `LIVEKIT_API_SECRET` only from `/opt/livekit/livekit.yaml` / PM.

**`lc-portal-prod` env** — every Vercel portal var, with these changes:
- **DROP** `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE` — the box trunk has Agora stripped; it never reads them (they stay on Vercel per invariant 4).
- **ADD** (LiveKit — the box video provider; exact names verified in `apps/portal/lib/video/provider.ts`):
  - `LIVEKIT_URL=wss://livekit.lobby-connect.com`
  - `LIVEKIT_API_KEY=lc_prod`
  - `LIVEKIT_API_SECRET=` ⟨CONFIRM — the `lc_prod` secret from `/opt/livekit/livekit.yaml` / PM⟩
  - **Do NOT set `VIDEO_PROVIDER`** — it was removed with the Agora strip; it is a dead env on the current trunk (verified: 0 source references).
- **RETARGET** (host-bound):
  - `NEXT_PUBLIC_APP_URL=https://app.lobby-connect.com` *(build var)*
  - **`KIOSK_ORIGIN=https://kiosk.lobby-connect.com` — ⚠ BUILD-AFFECTING, not runtime.** It is read in `apps/portal/next.config.ts` `headers()` to bake `Access-Control-Allow-Origin` for **`/api/kiosk/*` AND `/api/video/*`** into the standalone image. If it's wrong/stale at **build** time, the browser blocks every cross-origin kiosk→portal call — including `/api/video/token` → **kiosk config + video both fail**, and a restart will NOT fix it (**redeploy** required). Must be `https://kiosk.lobby-connect.com` at image-build. *(It is also read at runtime as the signed-kiosk-link base in `admin/properties/actions.ts` — same value, but the build-time CORS role is the load-bearing one.)*
- **KEEP IDENTICAL** (same values as Vercel — shared prod DB / same Twilio account / signed-link continuity):
  - Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  - Twilio: `TWILIO_ACCOUNT_SID`, **`TWILIO_AUTH_TOKEN`** (HMAC — must match or every webhook 403s; see §4 risk), `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_PHONE_NUMBER`, `EMERGENCY_DIAL_NUMBER` *(⟨CONFIRM⟩ the value — must be the real 911 target for prod; temporarily `933` only during the night-1 emergency test, then reverted — see §6)*
  - `SPEECHMATICS_API_KEY` ← **must be present** (captions)
  - Sentry: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_READ_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`
  - VAPID: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` *(already on Coolify staging per handoff — reuse the same values)*
  - `CRON_SECRET`, **`KIOSK_CONFIG_SECRET`** (byte-identical — invariant 6)

**`lc-kiosk-prod` env** — copy ALL `VITE_*` from the Vercel kiosk project (don't assume a count), all are build vars → redeploy to change:
- `VITE_PORTAL_API_URL=https://app.lobby-connect.com` *(RETARGET — points the kiosk at the box portal)*
- `VITE_SENTRY_DSN=` ⟨CONFIRM — same value as Vercel kiosk⟩
- *(The kiosk needs NO `LIVEKIT_*` — it receives the LiveKit ws URL at runtime from the portal's `/api/video/token` response. Do not add a `VITE_LIVEKIT_URL`.)*

### 2.5 — Prod crons on `lc-ops`
Add prod scheduled tasks alongside the staging ones (the box is now prod; reaper `*/15` finally runs in prod):

| Task | Cron (UTC) | Command |
|---|---|---|
| `prod-reaper` | `*/15 * * * *` | `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://app.lobby-connect.com/api/cron/reap-stale-calls` |
| `prod-presence` | `0 8 * * *` | `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://app.lobby-connect.com/api/cron/mark-stale-offline` |

`prod-pg-dump` already exists and already targets the prod DB — leave it. Staging reaper/presence can keep running (each hits its own URL).

> **⚠ Three cron sources will hit the shared prod DB during the window, not one.** The **frozen Vercel standby is git-disconnected but NOT deleted/paused**, so its own two `vercel.json` crons (`mark-stale-offline` 08:00, `reap-stale-calls` 20:00) **keep firing against the same prod Supabase** alongside the box's `prod-reaper */15` + `prod-presence`. This is **safe by idempotency** — the reaper is state-guarded first-writer-wins, and the presence sweep is convergent — so concurrent runs can't corrupt. The Vercel crons **cannot be disabled without editing/redeploying the frozen standby**, which invariant 7 forbids → **accept them, don't try to stop them.**

### 2.6 — Enter the pilot's RustDesk credential (box-prod admin)
On the box-prod portal, sign in as admin → the pilot property → **Remote-access card** → enter the hotel PC's **`peer_id` + unattended password** (from PM). This writes the `property_remote_access` row (migration 0020) on prod. The password's runtime home moves PM → the DB vault; **keep the PM copy as backup** (D14). Entered **as-is / plaintext at rest** — the app-layer encryption hardening is deliberately **post-cutover / pre-second-hotel**, NOT a go-live gate (Kumar 2026-07-08).

### 2.7 — Verify the box as prod BEFORE flipping any pointer
With DNS live but no pointer flipped, exercise the box directly on `app.lobby-connect.com` / `kiosk.lobby-connect.com`:
- [ ] `https://app.lobby-connect.com` serves the portal with a valid **production** Let's Encrypt cert — **not the LE staging CA** (a staging-CA cert is untrusted → Twilio's HTTPS webhook would reject it at go-live). Check the issuer chain, not just "padlock".
- [ ] Sign in (agent + admin) against **prod** Supabase on the box host; go on-duty.
- [ ] `https://kiosk.lobby-connect.com` loads the kiosk against the box portal.
- [ ] **Cross-origin CORS proof (KIOSK_ORIGIN baked right):** from the kiosk host, confirm an actual `/api/kiosk/config` (and `/api/video/token`) call **succeeds** — the response `Access-Control-Allow-Origin` echoes `https://kiosk.lobby-connect.com`. (Not just "the kiosk page loads" — a wrong-baked `KIOSK_ORIGIN` fails only on the cross-origin fetch.)
- [ ] **Migration proof (0019/0020 applied):** push subscription registers (VAPID + `push_subscriptions`) **returns 200**, and the admin Remote-access route (`property_remote_access`) **returns 200** — both 500 if the DB lagged at 0018.
- [ ] Admin Remote-access card shows the pilot credential exists (write-only; password not re-fetched).
- [ ] LiveKit token route responds (video path healthy) — a self-initiated test kiosk→agent video call over the box, if feasible before go-live.
- [ ] Dashboards render; `/admin/status` heartbeats present; `prod-reaper` fires at `*/15`.

If all green, the box is a proven prod stack that simply has no live traffic yet. Go-live is now just the pointer flips in §4.

---

## 3. The go-live pointer sets (both values)

Only **three** pointers flip (straight-to-box). Sentry is **not** a flip — it follows the DSN env already set in §2.4 (no host-bound origin config exists in code).

| # | Pointer | CURRENT (Vercel standby) | TARGET (box) | Where | Rollback = set back to CURRENT |
|---|---|---|---|---|---|
| a | Twilio "A CALL COMES IN" (POST) | `https://lobby-connect-portal.vercel.app/api/twilio/voice/incoming` ⟨CONFIRM⟩ | `https://app.lobby-connect.com/api/twilio/voice/incoming` | Twilio console → pilot number → Voice config | ✅ instant |
| a | Twilio "CALL STATUS CHANGES" (POST) | `https://lobby-connect-portal.vercel.app/api/twilio/voice/status` ⟨CONFIRM⟩ | `https://app.lobby-connect.com/api/twilio/voice/status` | same | ✅ instant |
| b | Pilot tablet kiosk bookmark | `https://lobby-connect-kiosk.vercel.app` (its signed `?t=` config link) | `https://kiosk.lobby-connect.com` (re-issue the signed link from box-prod admin) | On the tablet, on-site | ✅ seconds (on-site) |
| c | Supabase Auth **Site URL** | `https://lobby-connect-portal.vercel.app` ⟨CONFIRM⟩ | `https://app.lobby-connect.com` | Supabase → Auth → URL Configuration | ✅ set back |
| c | Supabase Auth **Redirect allowlist** | ⟨CONFIRM current entries⟩ | **ADD** `https://app.lobby-connect.com/**` (keep the Vercel entry too — allowlist BOTH during the window) | same | leave both allowlisted |

**Notes on the pointers:**
- **(a) Twilio** — the pilot DID (E.164) is ⟨CONFIRM in Twilio console⟩; it equals the pilot property's `routing_did`. Twilio's `dial-result` callback is set by TwiML **at runtime**, not in the console — it inherits the request host automatically, so it needs no manual change. Route paths exist at `apps/portal/app/api/twilio/voice/{incoming,status,dial-result,answered}`.
- **(b) Tablet** — because `KIOSK_CONFIG_SECRET` is identical across stacks (invariant 6), the box-prod admin can re-issue the signed kiosk link and it validates immediately; the tablet just needs its bookmark/URL swapped and the page reloaded.
- **(c) Supabase Auth — effectively a NO-OP for the pilot; do it LAST, non-blocking.** The auth session **cookie is set on the app's own origin** by `@supabase/ssr` — it is NOT governed by the Supabase "Site URL" setting. So password sign-in works on `app.lobby-connect.com` (box) and on `lobby-connect-portal.vercel.app` (standby) **independently of Site URL**. The "Site URL" only drives **email-link redirect targets**, and those flows are **dormant** (admin-provisioned auth, no SMTP). Therefore: adding `app.lobby-connect.com/**` to the redirect **allowlist** (keep the Vercel entry) is the only thing that matters, and even that is belt-and-suspenders for the pilot; updating the Site URL itself is cosmetic and its rollback is non-urgent. Agents will re-login when they move to the box host — that's a new cookie origin, expected, and happens regardless of any Supabase setting.

---

## 4. GO-LIVE runsheet (daytime, ordered)

**Precondition:** §2 fully green; DO snapshot taken; Kumar on-site with the tablet; a phone to place the pilot-number test call. **The cutover night-1 IS the live test** — per Kumar (2026-07-08), both the Phase-2 RustDesk-relay real-night gate and the video-quality gate are satisfied *by* this live shift on the box (they passed extensive non-shift testing; only a real prod shift proves them), with the frozen Vercel standby as the instant rollback if either fails. So go-live is not blocked on a prior separate relay night — night-1 doubles as it (see §6).

**Order = prove the sharpest, instant-revert pointer FIRST; move the guest-facing surface only after voice is confirmed.**

0. **Agents on the box:** the on-duty agent(s) sign in on `https://app.lobby-connect.com` and go on-duty. (Works regardless of Supabase Site URL — §3(c).)
1. **Twilio (a) — the sharp one; flip-then-immediately-self-test:**
   - In the Twilio console, set **both** Voice URLs (incoming + status) → `https://app.lobby-connect.com/api/twilio/voice/{incoming,status}`.
   - **Immediately place a test call to the pilot number yourself.** A green two-way answered call on the box = HMAC verified through Traefik + routing works → **stay** (this call *is* go-live). A failure (silent / apology / no route) = suspect the **HMAC host-match interlock** (Risk R1) → **revert the Twilio URLs to Vercel** and debug before retrying. Instant rollback, zero pilot cost.
   - **If it 403s, distinguish the cause before assuming a token mismatch:** check the box logs / Sentry for the *reconstructed URL* — a right-host-but-wrong-port (`:3000`) or wrong-proto reconstruction 403s **identically** to a bad `TWILIO_AUTH_TOKEN`. Confirm the reconstructed URL is exactly `https://app.lobby-connect.com/api/twilio/voice/incoming` (no embedded port, proto `https`).
2. Confirm `/admin/status` on the box shows the Twilio webhook heartbeat landing (proves inbound reached the box).
3. **Tablet (b) — only after voice is green:** on the pilot tablet, open the box-prod admin, re-issue the kiosk config link, point the tablet at `https://kiosk.lobby-connect.com`, reload. Confirm the kiosk Home renders and is paired to the pilot property. (Moving the guest-facing surface last means a failed voice self-test reverts with the kiosk never having moved.)
4. **Supabase Auth (c) — last, non-blocking:** add `https://app.lobby-connect.com/**` to the redirect allowlist (keep the Vercel entry); optionally update Site URL. Cosmetic for the pilot (§3(c)) — do not gate anything on it.
5. Announce go-live to Dilnoza; proceed to the night-1 smoke (§6).

**What did NOT change:** DNS (already → box since §2.2), the box apps/env (already up), the prod DB (shared, never forked). The only live-state changes are the pointers above.

---

## 5. ROLLBACK runsheet — REHEARSE THIS ONCE before go-live

Rollback = set the three pointers back to their CURRENT (Vercel) values. The Vercel standby is unchanged and warm; the shared prod DB carries all rows written while on the box (old Agora code ignores the 0019/0020 tables). **Trigger:** any critical night-1 failure Kumar judges un-hotfixable in the moment (broken voice routing, video unusable on the real iPad, auth broken, etc.).

1. **Twilio (a):** set both Voice URLs back to `lobby-connect-portal.vercel.app`. **Voice is restored the instant Twilio re-reads the config** (no DNS, no propagation). Test-call to confirm.
2. **Tablet (b):** on-site, point the tablet back to `https://lobby-connect-kiosk.vercel.app` and reload. Video/kiosk restored.
3. **Supabase Auth (c):** cosmetic/optional — both origins stay allowlisted, so password sign-in on the Vercel host already works (§3(c)); set Site URL back only for tidiness, no urgency.
4. The pilot is now served entirely by the frozen Vercel/Agora standby, exactly as before go-live. The box keeps running (no traffic); debug it offline, then re-attempt go-live.

**Rehearsal (do once, pre-go-live, at a quiet moment):** flip Twilio → box, place one test call, confirm it answers on the box, then flip Twilio → Vercel and confirm a test call answers on Vercel. This proves *both* directions of the voice pointer and de-risks R1 before the real cutover. (This rehearsal doubles as the R1 pre-test.)

---

## 6. Night-1 smoke checklist (Kumar + Dilnoza)

The real shift on the box **is** the test (both passed extensive non-shift testing; only a live shift on prod can prove them). Debug anything serious → §5 rollback.

**Voice (Twilio → box, first live proof):**
- [ ] Inbound call → exactly ONE ring on the audio card (softphone owns `/sounds/ring.mp3`; double-ring or no-ring = a known softphone audio failure mode).
- [ ] Answer → two-way audio both directions.
- [ ] Audio in-call overlay: hotel local time ticks · Room#/notes save on ⏎ · Mute · Hang up finalizes (row → COMPLETED, not leaked IN_PROGRESS).
- [ ] Answer on the expanded **property card** (agent AND covering admin).
- [ ] Presence-gated dial reaches the online agent (single-agent fan-out; Twilio concurrency cap is still v2).

**Video (LiveKit) — on the REAL iPad kiosk (hardware H.264 is the quality gate; Mac-Chrome was a pessimistic proxy):**
- [ ] Kiosk tap → card rings → two-way A/V through box LiveKit.
- [ ] **Dilnoza places deliberate India→NYC3 test video calls** — the one thing staging could not prove (single-region SFU vs Agora's edge near her). Quality ≥ Agora, else there is no partial fallback → whole-stack rollback (§5).
- [ ] Busy webcam → degrades to connected audio-only (not a dropped call).
- [ ] Guest-side hang-up clean; row finalizes.

**Captions:** [ ] live captions render on the guest's speech (first prod proof with `SPEECHMATICS_API_KEY` present on the box).

**Push / OS ring (the audible contract):**
- [ ] Loud ring lands with the browser **minimized behind fullscreen RustDesk** (Web Push path).
- [ ] OS toast observed; click focuses the portal. Ring fires even when the tab is throttled/backgrounded.

**Connect (RustDesk) — every surface, incl. the never-live-verified one:**
- [ ] Connect from the **property card** (agent) → native RustDesk opens key-authed, no password prompt.
- [ ] **Admin Connect to a NON-covered property** (covering-independent for admins).
- [ ] Connect from inside a live **VIDEO** call (overlay AND tile) → **video survives the launch** (the `13acedb` hidden-iframe fix; a top-window nav would kill the LiveKit PeerConnection).
- [ ] **Connect from the AUDIO in-call overlay** — the ONE Phase-E surface staging could never live-verify (no Twilio on staging; jsdom-only). First real test.
- [ ] `/admin/audit`: `remote_access.credentials_issued` rows with correct `trigger` (`prewarm` at Answer, `connect` on clicks); no double-audit on cache-hit clicks; password never in `details`.

**Duty (D13 server-truth):**
- [ ] "Go on duty" flips live; "End shift" silences BOTH audio + video rings immediately (admin fleet shows Off duty).
- [ ] Duty survives a refresh (refresh REFRESHes a live shift, can't re-enter one).

**Call tile:**
- [ ] opens on the Answer gesture · floats above fullscreen RustDesk · mute / hang-up / two-tap-911 (audio-only) / ⏎-notes / Connect / auto-close at hang-up.
- [ ] **White-bar dock check (open bug — first prod look):** switch tabs kiosk↔dashboard and confirm the tile's bottom control dock renders normally (NOT a dead white bar). The handoff flags this as a low-confidence, likely-staging-only artifact (softphone focus-flap with no Twilio) — prod has real Twilio, so if it never appears here it's confirmed staging-only; if it DOES appear, capture it and investigate.

**RustDesk relay (Phase-2 done-when — satisfied on this shift):**
- [ ] Dilnoza works the full shift with her RustDesk sessions running **through our relay** (`relay.lobby-connect.com`; P2P-direct when possible, hbbr fallback) with no dropouts → this clean real night **is** the Phase-2 done-when → stamp Phase-2 DONE + tag `plan-phase2-relay-complete`.

**911 (LIVE 933 test on the box — Kumar's decision):**
- [ ] Temporarily set `EMERGENCY_DIAL_NUMBER=933` on `lc-portal-prod` (restart), trigger the emergency path on a test call, confirm the **conference merges** (guest + agent + 933 read-back leg) and the **server-driven agent mute/leave** work through Traefik, hear the E911 address read-back.
- [ ] **Revert `EMERGENCY_DIAL_NUMBER` to the real 911 target** and restart BEFORE the shift carries real guests. *(Double-check this revert — a stuck 933 means a real emergency would not reach a PSAP.)*

**Crons:** [ ] `prod-reaper` `*/15` fires (leaked rows auto-finalize); `prod-presence` runs.

---

## 7. Standby window (~2 weeks)

- Vercel stays frozen and warm; any critical issue → §5 rollback (minutes).
- **This window also absorbs the former Phase-1 one-week box-stability soak** (resequenced 2026-07-08) — the full week of clean box-as-prod nights is the Phase-1 done-when, with the Vercel standby as the net throughout.
- Watch: `/admin/status`, Sentry, nightly `pg_dump` success, LiveKit health, box resources (swap; bump 2→4 GB if the portal build OOMs).

---

## 8. Decommission (step 10 — only after a clean standby week)

- [ ] Close the **Vercel projects** (portal + kiosk) and the **Agora account**; remove `@vercel/analytics`.
- [ ] Revoke the two `lc-claude` API tokens (DO + Coolify; credentials register §4).
- [ ] Turn **DO auto-backups ON**; **upgrade Supabase to Pro** (unlocks real backups + HIBP leaked-password + the reaper stays `*/15`).
- [ ] Update docs: `docs/security-posture.md`, the `deploy-and-smoke-workflow` memory, CLAUDE.md deployed-URLs.
- [ ] Tags (some land BEFORE formal decommission, when their own done-whens are met): `plan-phase2-relay-complete` on Dilnoza's clean relay night (§6, likely night-1) · `plan-phase1-box-staging-complete` when the post-cutover box-prod week (§7) is clean · `plan-phase4-livekit-complete` + `plan-phase5-cutover-complete` at decommission.
- [ ] Now-safe (was blocked by invariant 3): the optional `agora_channel_name → video_room_name` rename becomes permissible once the standby is gone.
- [ ] **Post-cutover / pre-second-hotel** (its own brainstorm→spec→build; NOT a go-live gate): RustDesk credential hardening — app-layer AES-256-GCM encryption of `unattended_password` at rest + fail-closed issuance audit; then reconcile `security-posture.md` §6.5.
- [ ] The final DB decision (kept-managed is the standing lean; revisit with real ops experience).

**Phase-5 done-when:** a full week of nights served entirely off the owned box + Twilio + Supabase, Vercel and Agora accounts closed.

---

## 9. ⟨CONFIRM⟩ — console-only values to fill in before go-live

Read these from the live consoles and pin them into this doc (or a scratch note) before the cutover; do not guess:
1. **Twilio:** the pilot DID (E.164); the exact current stored Voice URLs + HTTP methods; whether any messaging webhook is set; the current `EMERGENCY_DIAL_NUMBER` value.
2. **Supabase Auth (`ztunzdpmazwwwkxcpyfp`):** the current Site URL + the full redirect allowlist entries.
3. **Sentry:** confirm the box-prod env carries the correct `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` / `VITE_SENTRY_DSN` (portal vs kiosk projects); there is no host-origin config to change.
4. **Vercel prod env values:** copy EVERY var from both Vercel projects (don't rely on a count) into the box, applying the §2.4 transform (drop `AGORA_*`, add `LIVEKIT_*` from PM/livekit.yaml — not Vercel, retarget the host-bound vars incl. build-affecting `KIOSK_ORIGIN`).
5. **LiveKit `lc_prod` secret** from `/opt/livekit/livekit.yaml` / PM.
6. **Coolify:** decide `production` environment name + confirm prod routers carry **no** basic-auth middleware.

---

## Risks / call-outs

- **R1 — Twilio HMAC host-match interlock (sharpest).** Inbound webhooks are HMAC-verified over the **full reconstructed URL** (`publicUrlFromRequest()` = `host` + `x-forwarded-proto`, `apps/portal/lib/twilio/client.ts`). Twilio signs over `https://app.lobby-connect.com/...`; the box must reconstruct exactly that. If Traefik/Coolify doesn't forward `Host` verbatim or sets a different `x-forwarded-proto`, **every webhook 403s** → no routing. This path has **never** run on the box (staging has no Twilio). **Deceptive failure mode:** a right-host-but-wrong-**port** reconstruction (e.g. `app.lobby-connect.com:3000` if Traefik forwards the upstream port) or a wrong proto 403s **identically** to a bad `TWILIO_AUTH_TOKEN` — so on a 403, inspect the actual reconstructed URL in logs/Sentry before concluding it's the token (see §4 step 1). Mitigation: the §5 rehearsal (flip Twilio → box, self-test, flip back) proves it before go-live; go-live itself is flip-then-immediately-self-test with instant revert. `TWILIO_AUTH_TOKEN` must also be byte-identical on the box (a different token = 403; `getTwilioConfig()` throws if unset → fail-closed).
- **R2 — India→NYC3 SFU video quality.** Single-region box vs Agora's global edge; unprovable on staging. Deliberate night-1 India test calls; no partial fallback → whole-stack rollback if it regresses.
- **R3 — 933→911 revert.** The live 933 test requires temporarily setting `EMERGENCY_DIAL_NUMBER=933`; a forgotten revert means real 911 fails. Gate the shift on the revert (§6).
- **R4 — `main` auto-deploy during stand-up.** Prod apps track `main`; disable auto-deploy until the env is complete, or a mid-config `main` push redeploys prod.

---
*Runsheet ends. Cross-checks: prod migration high-water (0018) and prod ref verified live 2026-07-08; env var names verified against `apps/portal/lib/video/provider.ts`, `apps/portal/lib/env.ts`, `apps/kiosk/src/lib/{config,sentry}.ts`; `VIDEO_PROVIDER` confirmed removed (0 source refs).*
