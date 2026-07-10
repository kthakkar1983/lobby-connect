# Part 5 env vars — code-grounded inventory (companion to the cutover playbook)

**Written:** 2026-07-09 · Reference companion to `2026-07-08-phase5-cutover-operator-playbook.md` **Part 5**. The playbook's Part-5 table is the primary checklist; this is the *evidence* — every env var the box-prod apps read, with `file:line` and a precise build-time-vs-runtime classification. Produced by a code-reading pass over `main` + verified against the Dockerfiles and live staging.

## The load-bearing mechanism (verified)

- `apps/portal/Dockerfile` and `apps/kiosk/Dockerfile` are **byte-identical between `main` and `origin/staging`** (`git diff` empty). Prod builds from `main`; staging builds from `staging`; same Dockerfile → same build behavior.
- Neither portal Dockerfile has an `ARG KIOSK_ORIGIN` or `ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY`, yet **live staging bakes the correct CORS origin** (`curl` of `/api/kiosk/config` returns `access-control-allow-origin: https://staging-kiosk.lobby-connect.com`). ⇒ **Coolify injects "Build Variable"-flagged env into `next build`/`vite build` without a Dockerfile `ARG`.** Mirroring staging's variable set + Build-Variable flags reproduces this on prod by construction.
- **Failure mode of a mis-flag:** a clean, green deploy with a broken *browser* (localhost CORS, `undefined` `NEXT_PUBLIC_*`) and **no error in any log.** The Part-9 curl (CORS) + push-arm (VAPID) checks are the ground truth.

## Portal — BUILD-TIME (must be correct at Deploy; flag as Build Variable)

| Var | Prod value | Evidence / why build |
|---|---|---|
| `KIOSK_ORIGIN` | **RETARGET → `https://kiosk.lobby-connect.com`** | `next.config.ts:7,29-30` — baked as `Access-Control-Allow-Origin` on `/api/kiosk/*` **and** `/api/video/*`. **No Dockerfile `ARG`** → depends 100% on the Coolify Build-Variable flag. Wrong → `http://localhost:5173` → kiosk + video CORS-dead. Redeploy to fix (not a restart). |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | same as Vercel (reuse the keypair already on Coolify staging) | `lib/push/client.ts:16`, browser-inlined, **no server fallback**. **No Dockerfile `ARG`** → Build-Variable flag only. Runtime-only → `armPush()` false → web-push silently dead. |
| `NEXT_PUBLIC_SUPABASE_URL` | same as Vercel (`ztunzdpmazwwwkxcpyfp`) | `lib/supabase/browser.ts:14` (client, inlined) + `lib/env.ts:20` (server). Dockerfile `ARG` present. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same as Vercel | `lib/supabase/browser.ts:15` + `lib/env.ts:22`. Dockerfile `ARG` present. |
| `NEXT_PUBLIC_APP_URL` | **RETARGET → `https://app.lobby-connect.com`** | `app/(auth)/forgot-password/actions.ts:22` (server; falls back to `localhost:3000`). Dockerfile `ARG` present. **Already in the playbook Part-5.1 table.** Low impact (email reset dormant). |
| `NEXT_PUBLIC_SENTRY_DSN` | same as Vercel | `instrumentation-client.ts:6`. Optional (observability). Dockerfile `ARG` (defaults `""`). |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | same as Vercel | `next.config.ts:36-38` — build-time source-map upload. All optional (also read at runtime for `/admin/status`). |

> **Do NOT set `BUILD_STANDALONE`** — hardcoded `ENV BUILD_STANDALONE=1` in `apps/portal/Dockerfile:26` (drives `output:"standalone"`, `next.config.ts:16`). `NODE_ENV`/`NEXT_RUNTIME` are framework-managed — don't set. `CI` — leave unset.

## Portal — RUNTIME (set on the container; no rebuild to change)

| Var | Prod value | Evidence |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | same as Vercel | `lib/env.ts:30`. Dockerfile stubs a `build-time-dummy` (line 31); real value needed at runtime. **Module-load gotcha:** `lib/env.ts` calls `required()` at import for the 3 Supabase vars → a server module importing `@/lib/env` can throw during `next build` page-data collection, so its *presence* matters for a clean build too. |
| `LIVEKIT_URL` | `wss://livekit.lobby-connect.com` | `lib/video/provider.ts:18` |
| `LIVEKIT_API_KEY` | `lc_prod` | `lib/video/provider.ts:19` |
| `LIVEKIT_API_SECRET` | **from PM / box `livekit.yaml`** — NOT on Vercel | `lib/video/provider.ts:20` |
| `TWILIO_ACCOUNT_SID` | same as Vercel | `lib/twilio/config.ts:24,50` |
| `TWILIO_AUTH_TOKEN` | **same as Vercel — byte-identical** | `lib/twilio/config.ts:25` → HMAC verify. **R1** — see below. |
| `TWILIO_PHONE_NUMBER` | same as Vercel | `lib/twilio/config.ts:26` |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | same as Vercel | `lib/twilio/config.ts:51-52` — softphone token minting |
| `EMERGENCY_DIAL_NUMBER` | `911` (or `933` for the night-1 test, then flip to `911`) | `lib/emergency/dispatch.ts:9` — defaults to `911` if unset |
| `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | same as Vercel | `lib/push/vapid.ts:13-14` |
| `KIOSK_CONFIG_SECRET` | **same as Vercel — byte-identical** | `lib/kiosk/config-secret.ts:12` — signs the existing kiosk `?t=` tokens; mismatch → tablet 401 |
| `CRON_SECRET` | same as Vercel (must match the `lc-ops` cron caller) | `app/api/cron/*/route.ts` |
| `SPEECHMATICS_API_KEY` | from PM (credentials register) | `app/api/captions/token/route.ts:16` — captions → 503 if absent (non-blocking) |
| `SENTRY_DSN` / `SENTRY_READ_TOKEN` | same as Vercel | `sentry.server.config.ts:5` / `lib/sentry/errors.ts:14` — optional |

## Kiosk (all build-time `VITE_*`, inlined into `/dist`)

| Var | Prod value | Evidence |
|---|---|---|
| `VITE_PORTAL_API_URL` | **RETARGET → `https://app.lobby-connect.com`** | `src/lib/config.ts:17-18` — **throws "Missing VITE_PORTAL_API_URL" at first load if empty.** Dockerfile `ARG` (line 13). ⚠ The Vercel-pulled `apps/kiosk/.env.production.local` shows this as `""` — **ignore that; set `https://app.lobby-connect.com`**. |
| `VITE_SENTRY_DSN` | *(not threaded — see note)* | `src/lib/sentry.ts:7`. **The kiosk Dockerfile only `ARG`s `VITE_PORTAL_API_URL`** (line 13) → kiosk Sentry is a **no-op on the box** unless you add the ARG. Same as staging today (not a regression). **Decision: accept (observability-only); revisit post-cutover.** |

> Kiosk needs **no** `LIVEKIT_*` / `AGORA_*` — it gets `{url, token}` from the portal's `/api/video/token` at runtime (`src/lib/video/livekit.ts:49,95`). Confirmed zero video-secret env in the kiosk.

## Do NOT set (stripped / dead / framework-managed)

- **`VIDEO_PROVIDER`** — removed with Agora; dead. **`AGORA_*`** — zero source reads in either app (fully stripped). The only remaining `agora` token is the DB **column** `agora_channel_name` (retained per the blue-green invariant — **do NOT rename while the Vercel standby lives**); never a `process.env` read.
- **`BUILD_STANDALONE`** — Dockerfile-hardcoded. **`NODE_ENV` / `NEXT_RUNTIME`** — framework-injected. **`CI`** — leave unset.

## R1 — Twilio HMAC (the sharp risk), code-grounded

`parseVerifiedTwilioWebhook` (`lib/twilio/client.ts:46-58`) HMAC-verifies over `publicUrlFromRequest()` (`:28-34`), which reconstructs **`{x-forwarded-proto}://{Host header}{path}{search}`**. Twilio signed exactly `https://app.lobby-connect.com/api/twilio/voice/incoming`, so **Traefik must forward `Host: app.lobby-connect.com` (public FQDN, no `:3000`) + `X-Forwarded-Proto: https`.** A wrong Host / injected port / dropped proto → `validateRequest` false → **403 `"Invalid signature"` (line 55) — bare, no URL logged, no Sentry** — indistinguishable at a glance from a wrong `TWILIO_AUTH_TOKEN`. The same reconstructed origin also builds the `dial-result` callback URL (`app/api/twilio/voice/incoming/route.ts:105`), so a bad `Host` breaks the callback too.

**On a 403: suspect the Traefik-forwarded `Host` + `X-Forwarded-Proto` first, not the token.** Debug from Traefik's access log or a temporary log of `publicUrlFromRequest()` — the app will not print the reconstructed URL. Part 10's flip-there-and-back rehearsal is the de-risk.
