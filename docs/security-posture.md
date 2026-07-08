# Lobby Connect — Security & Data Posture (v1 pilot)

**As of:** 2026-06-20 (+ Phase-E remote-access addendum 2026-07-07, §6.5) · **Scope:** v1 pilot (one hotel, end-to-end) · **Audience:** the operator, a prospective hotel, or a reviewer who wants a plain-English account of how the system handles auth, tokens, caching, PII, and secrets.

This is a prose, audit-style writeup — not a code walkthrough. Every factual claim is either **source-backed** (cited to a file/line or a live tool result) or explicitly flagged as **inferred / not re-verified**, per the repo's sourcing discipline (`CLAUDE.md`). Line numbers reflect the state of the codebase on the date above and may drift; treat the filename as canonical and the line as a hint.

### How this document was produced

1. Direct reading of the auth, RLS, token, webhook, caching, and Sentry code (cited inline).
2. A live **Supabase security advisor** run against the production project (ref `ztunzdpmazwwwkxcpyfp`) on 2026-06-20 — an independent check of the live RLS/function configuration, not just the migrations.
3. A focused security-review pass over the auth / RLS / service-role / Twilio-HMAC / token surfaces. Its findings are folded into [§8 Known gaps](#8-known-gaps--hardening-backlog).

### One-paragraph summary

Lobby Connect is a single-tenant pilot built on Supabase Auth (password-only, admin-provisioned, no email/SMTP) with **Row-Level Security on every table** and a Next.js middleware session gate. Privileged operations run server-side only: the Supabase **service-role key never reaches the browser** and every route that uses it authenticates the caller first (a logged-in session, a Twilio HMAC signature, a kiosk HMAC token, or a cron bearer secret). Short-lived tokens (Twilio Voice and Agora, both 1 hour, held in memory) gate the realtime media paths; the long-lived credentials are the kiosk pairing token (a known, tracked gap) and — added in Phase E — the per-property RustDesk unattended password, which is plaintext at rest in a **service-role-only, zero-policy table** and read only through a single audited, `no-store` route (see [§6.5](#65-rustdesk-remote-access-credentials-phase-e-migration-0020--the-one-plaintext-credential-at-rest)). **Call recording is off** in v1, and crash/error reports are PII-scrubbed before they leave the apps. The review found no high- or medium-severity *exploitable* vulnerability; the open items are defense-in-depth hardening, tracked in `docs/v2-backlog.md`.

---

## 1. System & trust boundaries (orientation)

Two deployed surfaces:

- **Portal** (`apps/portal/`, Next.js on Vercel) — the authenticated app for agents, admins, and owners, plus the unauthenticated machine endpoints: Twilio voice webhooks, the Agora/Twilio token minters, the kiosk API, and two cron jobs.
- **Kiosk** (`apps/kiosk/`, Vite SPA on Vercel) — runs on a tablet in the hotel lobby. It has **no user login**; it is paired to one property by a signed token (see [§4.4](#44-kiosk-config-token)).

Everything is one operator (one company) in v1. Every table nonetheless carries an `operator_id` column, which is the seam for multi-tenant SaaS later (locked decision #6). Source: schema in `supabase/migrations/0001_init.sql`.

The trust boundaries that matter:

| Boundary | Who's on the untrusted side | What enforces it |
|---|---|---|
| Browser ↔ portal pages | Any web client | Next.js middleware session gate + per-layout role gate (§3) |
| Browser ↔ authenticated API routes | Any web client | `requireApiActor()` (session → active → role) (§3.5) |
| Twilio ↔ voice webhooks | The public internet | Twilio HMAC signature verification (§7.3) |
| Kiosk ↔ kiosk API | The public internet | Per-property HMAC config token (§4.4) |
| Vercel Cron ↔ cron routes | The public internet | `CRON_SECRET` bearer check, fail-closed (§7.2) |
| Postgres rows | Any authenticated user | Row-Level Security on every table + column-guard triggers (§3) |

---

## 2. Authentication & access control

### 2.1 Supabase Auth — password-only, admin-provisioned, no email/SMTP

Sign-in is email + password through Supabase Auth. There is **no public sign-up and no email is sent during onboarding.** An admin creates a user by typing a temporary password; the user is created already-confirmed and can sign in immediately:

- `provisionUser()` (`apps/portal/lib/users/provision.ts:24`) calls `admin.auth.admin.createUser({ email_confirm: true, … })` (`:41`) — `email_confirm: true` means **no invitation email is dispatched** (`:39` comment). It then inserts the `profiles` row with `must_change_password: true` (`:68`), and **rolls back** the auth user if the profile insert fails (`:73`), so a half-created account can't linger.

This deliberately removes SMTP from the pilot's critical path. The email-invite and password-reset flows still exist as a dormant seam (`/auth/confirm` + `verifyOtp`) for when SMTP is configured later (source: `docs/specs/2026-06-04-09-admin-provisioning-design.md`; build log in `CLAUDE.md`, Plan 9).

### 2.2 First-login gate (`must_change_password`)

A provisioned (or admin-reset) user is forced to set their own password before they can use the app. The gate lives in the server-side role check:

- `requireRole()` (`apps/portal/lib/auth/require-role.ts:16`) resolves the session profile, then: if there's no profile or the account is inactive → redirect to `/sign-in` (`:19`); **if `must_change_password` is true → redirect to `/onboarding`** (`:23`), *before* the role check; only then does it compare roles (`:27`). Onboarding clears the flag via the admin client once the new password is set.

So a user with the flag set cannot reach any role-gated page regardless of their role. Source-backed.

### 2.3 The Next.js middleware gate

`apps/portal/middleware.ts` runs on every page request (not API routes). It does two things: refreshes the Supabase auth cookie, and **redirects any request without a valid session to `/sign-in`** (`:19-22`). It calls `supabase.auth.getUser()` (`:17`), which validates the token against the Supabase auth server rather than trusting a decoded cookie.

The matcher (`:42`) deliberately **excludes** `api/*` (those authenticate themselves), static assets, `_vercel/*`, and the unauthenticated auth pages (`sign-in`, `forgot-password`, `onboarding`, `auth/*`). The middleware uses the **anon** key, not the service role (`apps/portal/lib/supabase/middleware.ts:13`). Source-backed.

Role enforcement is **not** done in the middleware — it's layered in the server-component layouts (`requireRole("ADMIN"|"AGENT"|"OWNER")`) and re-checked in each authenticated API route. This is intentional defense-in-depth: the middleware answers "are you logged in?", the layouts/routes answer "are you allowed *here*?" (`require-role.ts:5-7` documents this). The security review verified all three role layouts call `requireRole`.

### 2.4 Row-Level Security on every table

RLS is the backstop under the app-level checks: even a direct PostgREST call with a user's token is constrained to the rows that user's role/operator/ownership allows.

- **RLS is enabled on all ten tables** — `operators`, `profiles`, `properties`, `property_assignments`, `admin_call_availability`, `calls`, `audit_logs`, `operator_settings` (`supabase/migrations/0002_rls.sql:13-20`), plus `incidents` (`0008_incidents_emergency.sql:37`) and `health_signals` (`0011_health_signals.sql:15`). The **live Supabase security advisor (2026-06-20) reported no RLS-disabled table and no over-permissive policy** — an independent confirmation that the migrations match the running database.
- Scoping is consistent: reads are gated by `operator_id = current_user_operator_id()` and then a role/ownership clause (admin sees the whole operator; an owner sees only their own properties/calls/incidents; an agent sees only assigned properties and calls they handled). See `calls_select` (`0002_rls.sql:142`), `properties_select` (`:64`), `incidents_select` (`0008:39`).
- **Writes to sensitive tables are service-role-only by design** — there is no `authenticated` INSERT/UPDATE policy on `calls`, `audit_logs`, `incidents`, or `health_signals`, so only server-side service-role code (Twilio webhooks, crons, audit writer) can write them. Default-deny does the work.
- There is **no `USING (true)`** or otherwise blanket-permissive policy anywhere (verified by reading `0002` and by the advisor).

### 2.5 Defense against self-service privilege escalation (column-guard triggers)

RLS is *row*-level: the `profiles_update_self` policy (`0002_rls.sql:46`) lets a user update *their own row*, which row-level RLS alone would allow them to use to flip their own `role` or `active`. That hole is closed at the *column* level by a `BEFORE UPDATE` trigger:

- `enforce_profile_self_columns()` (`0012_admin_provisioning.sql:14`) restricts a non-admin self-update to **`full_name` only** — any change to any other column (role, active, operator_id, must_change_password, status…) raises an exception (`:32-37`). Verified locally via simulated-JWT SQL when it shipped (Plan 9).
- Crucially, the trigger decides "is this a non-admin self-edit?" using `current_user_role()`, which reads `role` **from the `profiles` table** (`0001_init.sql:78-86`), **not** from a client-supplied JWT claim. So a forged or hand-edited JWT cannot escalate — the role is always re-read server-side from the database. Service-role writes have `auth.uid() = NULL` and skip the guard by design (`:28`), which is why presence updates (status/`last_seen_at`) must stay service-role.
- The same pattern guards owners: `enforce_owner_property_columns()` (`0010_owner_writes.sql:50`) lets an owner edit only the eight guest-facing `kiosk_*` fields, and `enforce_owner_incident_columns()` (`:88`) lets an owner only resolve an incident (and never re-open a resolved one). Both deny any not-yet-whitelisted column by default (jsonb subtraction), so a future column is protected automatically.

### 2.6 The API-route auth seam (also the v2 multi-tenant seam)

Authenticated API routes don't re-implement the session→profile→role dance; they call one helper:

- `requireApiActor({ allow: Role[] })` (`apps/portal/lib/auth/api-actor.ts`) resolves the session, loads the profile, **rejects an inactive account with 403**, and enforces the role allow-list — returning either an `ApiActor` or a `NextResponse` the route returns directly. For call-scoped routes, `fetchOperatorCall()` loads the call **and checks it belongs to the actor's `operator_id`**, which is the IDOR guard. The security review confirmed this is applied consistently across all twelve session API routes (token minting, answer/end video, playbook, notes, emergency, etc.).
- This helper is the single place the operator filter lives, which is the **v2 multi-tenant query-layer seam** (locked decision #6). v1 is single-tenant, so it gates role + active + operator only; per-property/assignment scoping is intentionally deferred to v2 (`CLAUDE.md`, Phase 2 notes).
- Route-specific authorization sits *after* the actor resolves — e.g. the call-notes and emergency-control routes additionally require `handled_by_user_id === actor.userId` (you can only act on a call you're handling), and the live-video and emergency routes reject the OWNER role.

**Net:** the role/route trust boundary is server-side (middleware + layouts + `requireApiActor`), with RLS + column-guard triggers as the database backstop. A forged JWT can't escalate (role is read from the table); an inactive user is locked out at the API boundary; cross-operator access is blocked by the operator filter.

---

## 3. Token retention & lifetimes

Four token systems are in play. Summary, then detail:

| Token | Lifetime | Where it lives | Refresh | Scope |
|---|---|---|---|---|
| Supabase session (JWT + refresh) | Access ~1h *(see note)*; refresh long-lived, rotating | **httpOnly cookies** (`@supabase/ssr`) | Auto, server-side, on each request | The signed-in user |
| Twilio Voice access token | **3600 s (1 h)** | **Browser memory** only | Auto, in-place before expiry | Receive-only, the user's own identity |
| Agora RTC token | **3600 s (1 h)** | **Browser memory** only (per join) | Re-fetched per call | One channel, publisher role |
| Kiosk config token | **No expiry** (long-lived) | **`localStorage`** + the pairing URL | n/a | One property |

### 3.1 Supabase session / JWT

The session is cookie-based via `@supabase/ssr` (`apps/portal/lib/supabase/middleware.ts`, `…/server.ts`). The server client reads/writes the auth cookies; the middleware refreshes them on every request and calls `getUser()` to revalidate against the auth server (so an expired or revoked session is caught server-side, not merely trusted from the cookie).

- **Exact access-token TTL — sourcing note:** the JWT expiry is a **Supabase project (GoTrue) setting configured in the Supabase dashboard, not in this repo**, so it is not citable to a file. Supabase's default is **1 hour** for the access token with a long-lived, rotating refresh token. I did **not** independently re-verify the live value for this project (the available management tooling did not expose the auth config), so treat "~1h access / rotating refresh" as the Supabase default — **inferred, not re-checked against the live project.** Everything else in this section is source-backed from code.
- The session cookies are managed by the SDK and are httpOnly (set with the SDK's cookie options in the server/middleware clients) — they are not readable by page JavaScript.

### 3.2 Twilio Voice access token

Used by the agent/admin softphone to *receive* inbound calls in the browser.

- **TTL = 3600 s (1 hour).** Constant `TOKEN_TTL_SECONDS = 3600` (`apps/portal/app/api/twilio/token/route.ts:10`), passed as the Twilio `AccessToken` `ttl` (`apps/portal/lib/twilio/token.ts:25`). Source-backed.
- **Receive-only.** The grant is `new VoiceGrant({ incomingAllow: true })` with **no outgoing application SID** (`token.ts:27`) — the browser token cannot place arbitrary outbound calls.
- **Bound to the caller's own identity.** The route authenticates first (`requireApiActor`, `route.ts:13`), then mints the token for `profile.twilio_identity` read from **the authenticated user's own row** (`:21-39`). A caller cannot request a token for someone else's identity. Owners are rejected (they have no `twilio_identity` → 403, `:27`).
- **Storage + refresh:** held in browser memory only (never persisted to cookie/localStorage). It is refreshed *in place* before expiry: `attachTokenAutoRefresh()` (`apps/portal/lib/voice/device-resilience.ts:23`) listens for the Twilio `tokenWillExpire` event and re-fetches `/api/twilio/token`, calling `device.updateToken(...)` so the registration never lapses. (This is the fix for the "phone line disconnected — reload" symptom; see `device-resilience.ts:14-22`.)

### 3.3 Agora RTC token

Used by both the kiosk and the agent for the two-way video call.

- **TTL = 3600 s (1 hour).** Constant `TOKEN_TTL_SECONDS = 3600` (`apps/portal/app/api/agora/token/route.ts:13`), used for both the token expiry and the privilege expiry (`apps/portal/lib/agora/token.ts:14-23`). Source-backed.
- **Channel-scoped to a live call.** The route looks up the `calls` row by `agora_channel_name`, requires it to be in an **active** state, and only then mints a token (`route.ts:25-33`). The kiosk branch additionally requires the token's property to match the call's property (`:42`); the session branch requires the actor's operator to match the call's operator (`:52`) and rejects owners (`:49`). So a token is only ever issued for a channel the requester legitimately belongs to.
- **Publisher role**, minted server-side from the Agora app certificate (`token.ts:16-23`); held in browser memory, re-fetched per join (kiosk `apps/kiosk/src/lib/portal-api.ts`; agent `components/video-call/video-call.tsx:55`).
- **Known gap:** the `uid` is taken from the request and not constrained to a role range — a low-severity, same-call-scoped issue tracked in [§8](#8-known-gaps--hardening-backlog).

### 3.4 Kiosk config token

The kiosk has no login; it is paired to one property by a signed token delivered in its URL (`/?t=…`) at setup.

- **HMAC-SHA-256**, base64url-encoded, of a small JSON payload `{ p: propertyId, t: issuedAt }` (`apps/portal/lib/kiosk/config-token.ts:14-23`). Verification uses a **length check then `crypto.timingSafeEqual`** (`:34-37`) — a constant-time compare, so the signature can't be brute-forced by timing.
- **No expiry.** The payload stamps an issued-at `t`, but `verifyKioskToken` **never checks it** (`:26-46`) — the token is intentionally long-lived (docstring `:18`, "long-lived device token"). The secret comes from the environment with **no weak default** — `getKioskConfigSecret()` throws if `KIOSK_CONFIG_SECRET` is unset (`apps/portal/lib/kiosk/config-secret.ts:13`).
- **Storage:** persisted to `localStorage` under `lc_kiosk_token` (`apps/kiosk/src/lib/config.ts`), initially carried in the pairing URL's `?t=` query param. There is no cookie.
- **This is the one long-lived credential in the system, and it gates the guest WiFi password** (`app/api/kiosk/config/route.ts:20,37`). That, plus the lack of per-property revocation, is the most material posture gap — see [§8](#8-known-gaps--hardening-backlog). It is consistent with the already-planned post-pilot device-registry work.

---

## 4. Caching — what is and isn't cached

Lobby Connect deliberately uses **very little caching**, and **no realtime subscriptions** (locked decision #4). Freshness comes from short-interval polling, not push.

- **React `cache()` request-deduplication (per-render only).** `getSessionProfile()` (`apps/portal/lib/auth/session.ts:20`) is wrapped in React's `cache()` so a layout and its page don't each hit Auth + Postgres for the same render — it is **render-scoped, not a cross-request cache** (`:16-19` comment; it explicitly does not span the middleware runtime). The same pattern is used for agent-coverage resolution (`lib/auth/agent-coverage.ts`). No user data is retained between requests by this.
- **`unstable_cache` — exactly one use.** `getCachedErrorCount()` (`apps/portal/lib/sentry/errors.ts:40`) caches the Sentry "recent errors" count for the `/admin/status` page with **`revalidate: 120`** (120 seconds) (`:43`). This exists only to avoid hitting Sentry's rate-limited issues API on every 20-second status-page tick (`:36-39`). It caches a single integer (a count), no PII.
- **Polling + refetch-on-focus.** Live-ish views use the `<AutoRefresh>` island (`apps/portal/components/auto-refresh.tsx`), which calls `router.refresh()` on a **20-second interval** (`:7`) and on window focus (debounced, `:17-19`). The one tightened exception is the incoming-**video** poll at 3 s, so the ring is prompt (`CLAUDE.md`, session 5).
- **What is *not* cached:** call data, presence, incidents, audit rows, owner/admin dashboards — these are fresh React Server Component reads on each render (the 20 s `router.refresh()` re-runs them), and mutations call `revalidatePath(...)`. There is no CDN/data caching of authenticated content.

---

## 5. PII handling

### 5.1 What counts as PII here

The sensitive data the system touches: the **guest's caller phone number** (`calls.caller_number`), the **guest WiFi password** (`properties.kiosk_wifi_password`), and — if it were ever enabled — **call recordings**. Names and emails of staff/owners are operational data behind auth + RLS.

### 5.2 Error/crash reporting is PII-scrubbed before it leaves the app

Both apps run Sentry, and every event passes through a scrubber in `beforeSend` *before* it is sent:

- `scrubPii()` / `scrubEvent()` (`packages/shared/src/sentry-scrub.ts`, re-exported via `apps/portal/lib/sentry/scrub.ts`) **drops any object key** named `caller_number` or `recording_url`, or matching `/token|secret|auth|signature|password|cookie|recording/i` (`:7-12`), and **redacts phone-shaped digit runs** from any free-text string (`PHONE_RE`, `:18`). As of this review it also redacts **Twilio recording URLs** (`…/Recordings/…`) from free text (`RECORDING_URL_RE`, `:23`) — see [§8](#8-known-gaps--hardening-backlog).
- The scrubber is wired as `beforeSend` in all three portal Sentry configs (`sentry.server.config.ts`, `sentry.edge.config.ts`, `instrumentation-client.ts`) and in the kiosk (`apps/kiosk/src/lib/sentry.ts`). Source-backed (grep-confirmed).
- A companion noise filter, `isTwilioTransportNoise()` (`apps/portal/lib/sentry/noise.ts`), drops only the benign empty rejection the Twilio Voice SDK emits during signalling-socket churn, and **only** when correlated with Twilio breadcrumbs — a genuine empty rejection from our own code is still reported (`:18-33`).
- Sentry is gated to deployed builds only, so local `dev` no longer pollutes the prod project (`CLAUDE.md`, §A 2026-06-20).

### 5.3 What the audit log records

`audit_logs` (`supabase/migrations/0001_init.sql:181-191`) stores: `operator_id`, `actor_user_id`, `actor_type` (`USER`/`SYSTEM`), `action`, `entity_type`, `entity_id`, a free-form `details` jsonb, and `created_at`. It has **no phone/recording/PII column**; `details` is an app-controlled jsonb object (`apps/portal/lib/auth/audit.ts:38-46`). Reads are **admin-only** (`audit_admin_select`, `0002_rls.sql:164`); writes are **service-role only** (no `authenticated` write policy), and the writer resolves the actor's `operator_id` from `profiles` rather than trusting caller input (`audit.ts:25-36`). So the audit trail is operator-scoped, admin-readable, and free of guest PII by construction.

### 5.4 Call recording is OFF in v1

The `calls` table has `recording_url` and `recording_sid` columns (`0001_init.sql:163-164`) as a forward-compat seam, **but they are never written.** A repo-wide search found these names only in (a) read-only owner/admin call-view SELECT lists, (b) the Sentry scrubber's sensitive-key set, and (c) generated DB types — **never in an INSERT/UPDATE** — and there is **no Twilio `record` attribute** anywhere in the TwiML/voice code. So there are no recordings to leak in v1; the call-detail "recording" UI is a dark seam. (Enabling recording is a documented pre-public-launch item, not a pilot feature.)

---

## 6. Secrets & the service-role boundary

### 6.1 The service-role key never reaches the browser

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS, so the entire posture depends on keeping it server-side. It is:

- Referenced in **exactly two files**: the env loader (`apps/portal/lib/env.ts:28`) and the admin-client factory (`apps/portal/lib/supabase/admin.ts:17`) — confirmed by repo-wide grep. It is **never** under a `NEXT_PUBLIC_` prefix (which is the only way Next.js ships an env var to the client) and **never hardcoded**.
- The factory `createAdminClient()` (`admin.ts:14`) is marked `import "server-only"` (`:3`) and disables session persistence/refresh (`:19-22`); the security review confirmed it is never imported into any `"use client"` file or into the kiosk app.

### 6.2 Every service-role surface authenticates the caller first

The service-role client is used in the surfaces below; the rule is that **none of them touch the database before establishing who's calling**:

| Surface | Files | Caller authenticated by |
|---|---|---|
| Twilio voice webhooks | `app/api/twilio/voice/{incoming,dial-result,status}/route.ts` | **Twilio HMAC** (`parseVerifiedTwilioWebhook`, §7.3) — verified before any DB access |
| Authenticated session routes | `app/api/twilio/voice/answered`, `app/api/agora/token` (session branch), `app/api/calls/[id]/{answer-video,end-video,playbook,emergency}`, `app/api/calls/{notes,incoming-video}`, `app/api/presence`, `app/api/twilio/token` | **`requireApiActor`** (session → active → role) + operator scoping, before privileged work |
| Kiosk routes | `app/api/kiosk/{config,call-started,call-ended}` (+ `heartbeat` via `recordHeartbeat`) | **Kiosk HMAC token** (`verifyKioskToken`) — the first statement in each route; 401 on failure |
| Cron jobs | `app/api/cron/{mark-stale-offline,reap-stale-calls}/route.ts` | **`CRON_SECRET` bearer**, fail-closed (§7.2) |
| Admin provisioning / onboarding | `app/(admin)/admin/users/actions.ts`, `app/(auth)/onboarding/actions.ts` | Server Action behind `requireRole("ADMIN")` / the authenticated onboarding user |
| Internal writers | `lib/auth/audit.ts`, `lib/health/heartbeat.ts` | Called only from already-authenticated paths; audit scopes by the actor's own `operator_id` |

For the session routes, note the operator scoping is enforced **in code** (`requireApiActor` + `fetchOperatorCall`, the v2 seam) rather than by RLS, because the service-role client bypasses RLS — which is exactly why those routes authenticate and operator-scope explicitly.

The most sensitive of these, the **911 emergency** trigger (`app/api/calls/[id]/emergency/route.ts`), is not externally reachable: it requires an authenticated actor, operator-scopes the call, and gates on `canTriggerEmergency` (the call must be `IN_PROGRESS`, `AUDIO`, and handled by *that* actor), claiming the escalation atomically. The agent's in-call mute/leave during a 911 conference go through a server route that re-checks `handled_by_user_id === actor.userId`. (Source: review of `lib/emergency/` + the emergency routes; build log Plan 6c / Phase 2.)

### 6.3 Cron secret — fails closed

The cron routes reject the request unless `Authorization: Bearer ${CRON_SECRET}` matches, and **a missing `CRON_SECRET` is treated as unauthorized, not as "skip the check"** (`app/api/cron/reap-stale-calls/route.ts`, `mark-stale-offline/route.ts`; the guard is `if (!secret || header !== "Bearer " + secret) return 401`). Boot also requires the var to be set (`apps/portal/instrumentation.ts:31-34`). Tested (`tests/app/cron-offline.test.ts`, `tests/app/cron/reap-stale-calls.test.ts` both assert the unset-secret → 401 case).

### 6.4 The Sentry token split

There are two Sentry tokens with different jobs, and they are not interchangeable:

- **`SENTRY_AUTH_TOKEN` — upload-only.** Used by `withSentryConfig` at build time to upload source maps. It returns 403 on the issues API (it lacks read scope), which once silently nulled the status card.
- **`SENTRY_READ_TOKEN` — read.** Used at runtime by the `/admin/status` error-count probe; `getRecentErrorCount()` **prefers the read token** and only falls back to the auth token (`apps/portal/lib/sentry/errors.ts:12-14`). This is also the token the `pnpm sentry:issues` CLI uses.
- Hygiene note: the prod `SENTRY_AUTH_TOKEN` was once pasted into a chat transcript and is filed for rotation in `docs/v2-backlog.md` (Observability / security). It's not in any file or commit.

### 6.5 RustDesk remote-access credentials (Phase E, migration 0020) — the one plaintext credential at rest

Phase E introduced a genuinely new class of secret: **per-property RustDesk unattended-access credentials** (`peer_id` + `unattended_password`) that let a night agent remote into the hotel PC. Unlike the four short-lived tokens in [§3](#3-token-retention--lifetimes), these are **long-lived and stored plaintext at rest**, so they get their own posture note. (Design decision D14; built + staging-smoked + merged 2026-07-07, PR #34.)

- **Storage — a service-role-only, zero-policy table with an explicit REVOKE.** `property_remote_access` (`supabase/migrations/0020_property_remote_access.sql`) has **RLS enabled with deliberately NO policies**, plus `revoke all on table … from anon, authenticated` — belt-and-suspenders in the 0014 spirit, so even a future accidental `create policy` cannot expose it to a client role. There is **no RLS grant path for any browser client**; every access runs through service-role code: the admin CRUD server actions (behind `requireRole("ADMIN")`) and the one audited credential API.
- **Plaintext at rest.** `unattended_password` is stored as plain `text`, protected only by Supabase's at-rest **disk encryption** (migration header). App-layer envelope encryption (riding per-connect password rotation) is a **v2 seam**, explicitly not v1 — recorded as an accepted pilot posture, not a silent gap.
- **The one read path is audited and never cacheable.** `GET /api/remote-access/[propertyId]` (`app/api/remote-access/[propertyId]/route.ts`) authenticates with `requireApiActor({ allow: ["AGENT", "ADMIN"] })`, **operator-scopes** (a row whose `operator_id` ≠ the actor's returns a 404 — the same "no such thing" response as a missing row, so it leaks nothing), and sets **`Cache-Control: no-store` on every response** — the codebase's first deliberately-uncacheable GET, because a secret must not land in any browser/shared cache. Because **issuance *is* the security event**, each successful read writes a `remote_access.credentials_issued` audit row with `details: { peer_id, trigger }` where `trigger ∈ {prewarm, connect}`. **The password is never in the audit `details`** (only the non-secret `peer_id`). The admin write path mirrors this: `remote_access.updated` / `.removed` audits never carry the password, and the card is **write-only** — the password is never re-fetched to the client, and a blank Save keeps the existing one.
- **No double-audit by design.** The `CallSurfaceProvider` **pre-warms** the credential once per answered call and caches it in refs; a cache-hit Connect launches synchronously and emits **no** additional audit row — so the trail reads as one issuance per call, not one per click. Verified live at the Phase-E staging smoke (4 prewarm rows + 1 connect across many in-call clicks).
- **Residual risk — the issuance audit is best-effort even here.** `logAuditEvent` (`lib/auth/audit.ts`) is a `Promise<void>` that (a) silently skips the row if the actor has no `profiles` row and (b) **does not check the `audit_logs` insert result** — a DB/network hiccup on the insert is swallowed ("the caller's main action already succeeded; audit is best-effort"). This is a codebase-wide posture, but it bites harder here than elsewhere: a credential can be *issued* without its issuance row landing. Accepted for the pilot; a hardened variant (fail the issuance if the audit write fails, or a durable outbox) is a v2 candidate. See [§8](#8-known-gaps--hardening-backlog).
- **Residency — where the plaintext actually lives.** At rest in: (1) the **prod Supabase DB**; (2) **every nightly `pg_dump`** on the box — the backup role `lc_backup` has **`BYPASSRLS`** (required for `pg_dump` over RLS tables), so the zero-policy table is fully included in each dump (`docs/setup/2026-07-02-box-ops-runbook.md`, backup section); (3) an operational **password-manager** copy of the pilot credentials; and (4) **transiently on staging** during a smoke — the Phase-E pilot row was entered and then **deleted after**, honoring D14's transient-residency intent. It is **never** in browser storage, a cookie, a log line, or a client bundle; the deep link hands the password to the **native RustDesk client in memory**, so it does not reach the agent's disk via the app.

---

## 7. Machine-to-machine endpoints (webhooks & crons)

### 7.1 Why these need their own auth

The Twilio webhooks, kiosk API, and crons have no user session, so they each carry their own credential (covered above). This section just records the verification mechanics for the webhooks.

### 7.2 Crons

See [§6.3](#63-cron-secret--fails-closed) — `CRON_SECRET` bearer, fail-closed, boot-required.

### 7.3 Twilio webhook HMAC verification

Every inbound Twilio webhook is HMAC-verified before it can drive any side effect (placing/connecting calls, finalizing call rows, routing into the 911 conference):

- `parseVerifiedTwilioWebhook()` (`apps/portal/lib/twilio/client.ts:46`) reads the form body, then calls `validateTwilioSignature()` (`:13`), which uses Twilio's official `twilio.validateRequest(authToken, signature, url, params)` (`:20`) — the standard HMAC-SHA-1-over-URL+sorted-params check, with the constant-time compare internal to the SDK. **A missing signature returns `false`** (`:18`), and **the verification cannot be turned off by a falsy env var** — `getTwilioConfig()` throws if `TWILIO_AUTH_TOKEN` is unset (`apps/portal/lib/twilio/config.ts:33`) rather than skipping the check. A forged webhook gets a 403 (`client.ts:55`).
- The signed URL is reconstructed from the `Host` + `x-forwarded-proto` headers (`:28-34`) to match what Twilio signed behind the tunnel. An attacker can influence those headers, but doing so only makes the signature check *fail* (a rejected webhook) — it cannot forge a *valid* signature without the Twilio auth token. (So this is an availability consideration, not a forgery path — see [§8](#8-known-gaps--hardening-backlog).)

---

## 8. Known gaps & hardening backlog

The review found **no high- or medium-severity *exploitable* vulnerability** in the auth / RLS / service-role / Twilio-HMAC / token surfaces. The items below are the honest residue: one fixed in this pass, two deferred to v2, and several "expected / accepted for the pilot" notes. Confidence ratings are the reviewer's.

### Fixed in this pass

- **Sentry scrubber didn't catch recording URLs in free text** (LOW; confidence 7/10). The scrubber dropped a key literally named `recording_url`, but a Twilio recording URL embedded in an error *message* or breadcrumb, or under a differently-cased key (`RecordingUrl`, `recording_sid`), would have passed through. v1 has no recordings, so there was no live exposure — but the seam exists. **Fixed** (TDD): the scrubber now also redacts `…/Recordings/…` URLs from free text and drops any `recording`-named key (`packages/shared/src/sentry-scrub.ts`; tests in `packages/shared/tests/sentry-scrub.test.ts`).

### Deferred to v2 (filed in `docs/v2-backlog.md` → Observability / security)

- **Kiosk config token has no expiry or per-property revocation** (MEDIUM; confidence 7/10). The per-property HMAC token never expires and can only be revoked by rotating the global secret (which re-pairs every property). A leaked pairing link is effectively a permanent credential for that one property, and it gates the guest WiFi password. **Why deferred, not fixed:** the proper fix needs a schema change (a per-property `kiosk_token_version`) and pairs with the already-planned post-pilot device-registry work; for a single trusted-tablet pilot the operational exposure is small. Fix sketch + acceptance in the backlog.
- **Agora token route doesn't constrain `uid` to a role namespace** (LOW; confidence 7/10). A valid kiosk token for a property in a live call can mint a publisher token for *any* uid on that (correctly channel-scoped) call, enabling an RTC-level uid collision within that single call. Cannot reach another property/operator. **Why deferred, not fixed:** it touches the live video token path, which is only smoke-testable on prod; the risk/reward doesn't favor a pre-pilot change to the core video path for a same-call-scoped LOW issue. Fix sketch in the backlog.

### Expected / accepted for the pilot (no action, documented for transparency)

- **RustDesk unattended passwords are plaintext at rest, and their issuance audit is best-effort** (LOW; see [§6.5](#65-rustdesk-remote-access-credentials-phase-e-migration-0020--the-one-plaintext-credential-at-rest)). The `property_remote_access` table is service-role-only (RLS-on, zero-policy, plus a REVOKE) and the sole read path is `requireApiActor`-gated, operator-scoped, `no-store`, and audited — but the password has **no app-layer encryption** (relies on Supabase disk encryption) and a failed `audit_logs` insert is swallowed, so a credential could be issued without its audit row. Accepted for a single-property pilot; app-layer envelope encryption (riding per-connect rotation) and a non-best-effort issuance audit are v2 candidates.
- **Supabase advisor: "Signed-In Users Can Execute SECURITY DEFINER Function"** (×7, WARN). The live advisor flags that the `authenticated` role can call the RLS-helper and trigger functions via PostgREST RPC. This is **by design and required**: migration `0014` deliberately revokes EXECUTE from PUBLIC/anon and **re-grants to `authenticated` and `service_role`** (`0014_revoke_helper_execute_from_public.sql:23-25`), because RLS policies evaluate `current_user_role()` / `current_user_operator_id()` / `user_owns_property()` / `user_is_assigned_to_property()` *as the querying user*, so `authenticated` must retain EXECUTE. Calling them directly returns only the caller's *own* role/operator/ownership (no escalation, no cross-tenant leak); the three `enforce_*` functions are trigger bodies that need trigger context and do nothing useful when called directly. Not a concrete vulnerability.
- **Supabase advisor: "Leaked Password Protection Disabled"** (WARN). The HaveIBeenPwned breached-password check is off on the live project. This is a **known, intentional deferral** to the Pro tier / public launch (`memory/launch-pro-tier-deferrals.md`; `docs/setup/2026-06-03-launch-checklist.md`), not a pilot blocker. The app already enforces a minimum password length in the UI.
- **Twilio webhook trusts `Host` / `x-forwarded-proto`** for URL reconstruction (`lib/twilio/client.ts:28`). Manipulating these headers can only cause a *valid* webhook to be *rejected* (the reconstructed URL stops matching the signature) — it cannot forge a valid signature. That's an availability/DoS consideration (explicitly out of scope for the vuln review), not a forgery path.
- **MFA is cut from v1** (schema-ready: `profiles.mfa_secret` exists, unused). Auth is single-factor password. Documented in `CLAUDE.md` v1 scope.

---

## 9. Confidence & sourcing summary

- **Source-backed (read directly from code/migrations, or a live tool result):** the RLS model and every policy/trigger cited; the column-guard escalation defense; the middleware/role gates; `requireApiActor`/operator scoping; the Twilio HMAC enforcement; all three short-lived-token TTLs and their storage; the single `unstable_cache` (120 s) and the `cache()`/polling model; the Sentry scrubber and its wiring; the audit-log schema and policies; "recording is off"; the service-role-key boundary and surfaces; the cron fail-closed check; the live Supabase security-advisor results (2026-06-20); and (2026-07-07) the Phase-E `property_remote_access` zero-policy + REVOKE table, the audited `no-store` credential route, and `logAuditEvent`'s unchecked (best-effort) insert.
- **Inferred / not re-verified:** the **exact Supabase access-token (JWT) TTL** — it is a Supabase dashboard setting, not in the repo; stated as the Supabase default (~1 h access + rotating refresh) and **not independently confirmed against the live project** here. If an auditor needs the exact value, read it from the Supabase dashboard (Authentication → Sessions/JWT).
- **Review confidence:** the auth/RLS/service-role surface is well-hardened (it carries the scars of a prior readiness audit). The open items are defense-in-depth, not open doors. The two deferred items are tracked with fix sketches and acceptance criteria in `docs/v2-backlog.md`.

---

*Maintenance: update this document when auth, RLS, token lifetimes, the caching model, the Sentry scrubber, the service-role surface, or the remote-access credential store changes — and re-run the Supabase security advisor after any migration.*
